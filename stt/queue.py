"""
queue.py — Async task queue with cancel/resume/pause/concurrent support.

Manages multiple transcription jobs with progress tracking and error recovery.
"""

import asyncio
import time
import uuid
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set
from dataclasses import dataclass, field

from .errors import QueueError, QueueFullError, TaskCancelledError
from .logging import log


class TaskStatus(Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Task:
    id: str
    name: str
    status: TaskStatus = TaskStatus.QUEUED
    progress: int = 0
    message: str = ""
    created_at: float = 0.0
    started_at: float = 0.0
    finished_at: float = 0.0
    result: Any = None
    error: str = ""
    cancellable: bool = True

    @property
    def duration(self) -> float:
        if self.finished_at > 0:
            return self.finished_at - self.created_at
        if self.started_at > 0:
            return time.time() - self.started_at
        return 0.0

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "duration": self.duration,
            "error": self.error,
            "cancellable": self.cancellable,
        }


class TaskQueue:
    """Async transcription task queue with concurrency control.

    Usage:
        queue = TaskQueue(max_concurrent=2)
        task = await queue.enqueue("my-task", worker_func)
        await queue.wait(task.id)
        print(task.result)
    """

    def __init__(self, max_concurrent: int = 2, max_queued: int = 10):
        self._max_concurrent = max_concurrent
        self._max_queued = max_queued
        self._tasks: Dict[str, Task] = {}
        self._queue: asyncio.Queue = asyncio.Queue()
        self._running: Set[str] = set()
        self._workers: Set[asyncio.Task] = set()
        self._lock = asyncio.Lock()
        # FIX BUG-13: Event per task untuk pause/resume yang sesungguhnya
        self._pause_events: Dict[str, asyncio.Event] = {}

    async def enqueue(
        self,
        name: str,
        worker: Callable,
        cancellable: bool = True,
    ) -> Task:
        """Add a task to the queue."""
        active = sum(
            1
            for t in self._tasks.values()
            if t.status in (TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.PAUSED)
        )
        if active >= self._max_queued + self._max_concurrent:
            raise QueueFullError("Task queue penuh. Tunggu task selesai.")

        task = Task(
            id=uuid.uuid4().hex[:12],
            name=name,
            status=TaskStatus.QUEUED,
            created_at=time.time(),
            cancellable=cancellable,
        )
        self._tasks[task.id] = task
        # Buat pause event (set = berjalan, clear = paused)
        self._pause_events[task.id] = asyncio.Event()
        self._pause_events[task.id].set()  # default: running
        await self._queue.put((task, worker))
        self._start_worker()
        return task

    def _start_worker(self) -> None:
        if len(self._running) >= self._max_concurrent:
            return
        worker = asyncio.create_task(self._run_worker())
        self._workers.add(worker)
        worker.add_done_callback(self._workers.discard)

    async def _run_worker(self) -> None:
        while True:
            try:
                task, worker = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if not self._tasks:
                    return
                continue

            async with self._lock:
                if task.status == TaskStatus.CANCELLED:
                    self._queue.task_done()
                    continue
                self._running.add(task.id)
                task.status = TaskStatus.RUNNING
                task.started_at = time.time()

            try:
                # Progress callback — cek pause sebelum update
                def progress_cb(pct: int, msg: str = "") -> None:
                    task.progress = pct
                    task.message = msg

                pause_event = self._pause_events.get(task.id)

                async def run_with_pause():
                    if asyncio.iscoroutinefunction(worker):
                        result_holder = []
                        error_holder = []
                        async def _run():
                            try:
                                result_holder.append(await worker(progress_cb))
                            except Exception as e:
                                error_holder.append(e)
                        task_coro = asyncio.create_task(_run())
                        while not task_coro.done():
                            if pause_event:
                                await pause_event.wait()
                            await asyncio.sleep(0.1)
                        if error_holder:
                            raise error_holder[0]
                        if not result_holder:
                            raise RuntimeError(f"Worker {task.name} selesai tanpa hasil dan tanpa error")
                        return result_holder[0]
                    else:
                        return await asyncio.to_thread(worker, progress_cb)

                result = await run_with_pause()

                task.result = result
                task.status = TaskStatus.DONE
                task.finished_at = time.time()
                task.progress = 100

            except TaskCancelledError:
                task.status = TaskStatus.CANCELLED
                task.finished_at = time.time()
                task.error = "Dibatalkan pengguna"

            except Exception as e:
                task.status = TaskStatus.FAILED
                task.finished_at = time.time()
                task.error = str(e)
                log.error(f"Task {task.id} failed: {e}")

            finally:
                async with self._lock:
                    self._running.discard(task.id)
                # Bersihkan pause event
                self._pause_events.pop(task.id, None)
                self._queue.task_done()

    async def cancel(self, task_id: str) -> bool:
        """Cancel a queued or running task."""
        task = self._tasks.get(task_id)
        if not task:
            return False
        if task.status in (TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED):
            return False
        task.status = TaskStatus.CANCELLED
        task.error = "Dibatalkan pengguna"
        return True

    async def pause(self, task_id: str) -> bool:
        """Pause a running task menggunakan asyncio.Event."""
        task = self._tasks.get(task_id)
        if not task or task.status != TaskStatus.RUNNING:
            return False
        # FIX BUG-13: clear event untuk benar-benar suspend worker
        event = self._pause_events.get(task_id)
        if event:
            event.clear()
        task.status = TaskStatus.PAUSED
        return True

    async def resume(self, task_id: str) -> bool:
        """Resume a paused task."""
        task = self._tasks.get(task_id)
        if not task or task.status != TaskStatus.PAUSED:
            return False
        # FIX BUG-13: set event untuk melanjutkan worker
        event = self._pause_events.get(task_id)
        if event:
            event.set()
        task.status = TaskStatus.RUNNING
        return True

    async def wait(self, task_id: str, timeout: float = 600) -> Any:
        """Wait for a task to complete.
        
        Returns result jika DONE.
        Returns None jika CANCELLED (dibatalkan dengan sengaja).
        Raises QueueError jika FAILED.
        """
        t0 = time.time()
        while time.time() - t0 < timeout:
            task = self._tasks.get(task_id)
            if task and task.status in (TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED):
                # FIX BUG-14: bedakan CANCELLED (intentional) vs FAILED (error)
                if task.status == TaskStatus.CANCELLED:
                    return None  # intentional cancel — bukan error
                if task.status == TaskStatus.FAILED and task.error:
                    raise QueueError(task.error)
                return task.result
            await asyncio.sleep(0.5)
        raise QueueError(f"Task {task_id} timeout setelah {timeout}s")

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def list_tasks(self, limit: int = 50) -> List[dict]:
        tasks = sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)
        return [t.to_dict() for t in tasks[:limit]]

    def cleanup(self, max_age: float = 3600) -> int:
        """Remove old completed tasks."""
        cutoff = time.time() - max_age
        to_remove = [
            tid for tid, t in self._tasks.items()
            if t.status in (TaskStatus.DONE, TaskStatus.FAILED, TaskStatus.CANCELLED)
            and t.finished_at > 0 and t.finished_at < cutoff
        ]
        for tid in to_remove:
            del self._tasks[tid]
        return len(to_remove)
