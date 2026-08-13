"""
logging.py — Structured logging with levels, file output, and structured records.
"""

import os
import sys
import json
import logging
from datetime import datetime
from typing import Optional


LOG_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


class StructuredFormatter(logging.Formatter):
    """JSON-structured log formatter."""

    def format(self, record: logging.LogRecord) -> str:
        return json.dumps({
            "t": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "line": record.lineno,
        }, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    """Human-readable console formatter with colors."""

    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[35m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        level = f"{color}{record.levelname:>7}{self.RESET}"
        return f"[{level}] {record.getMessage()}"


def create_logger(
    name: str = "stt",
    level: str = "",
    log_file: str = "",
    structured: bool = False,
) -> logging.Logger:
    logger = logging.getLogger(name)
    level_upper = (level or os.environ.get("STT_LOG_LEVEL", "INFO")).upper()
    logger.setLevel(LOG_LEVELS.get(level_upper, logging.INFO))
    logger.handlers.clear()

    if structured:
        fmt = StructuredFormatter()
    else:
        fmt = ConsoleFormatter()

    console = logging.StreamHandler(sys.stderr)
    console.setFormatter(fmt)
    logger.addHandler(console)

    if log_file or os.environ.get("STT_LOG_FILE"):
        path = log_file or os.environ["STT_LOG_FILE"]
        try:
            fh = logging.FileHandler(path, encoding="utf-8")
            fh.setFormatter(StructuredFormatter())
            logger.addHandler(fh)
        except Exception as e:
            logger.warning(f"Cannot write log to {path}: {e}")

    return logger


log = create_logger()
