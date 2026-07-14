# TODO

## Phase 1 — Activity log UI (Project log)
- [ ] Locate where project logs are written/read (search for readProjectLog / activity in renderer)
- [ ] Add IPC/handler to read logs from `logService` (or add new service fn)
- [ ] Add UI tab/section in `renderer/App.tsx` to display activity log per active project
- [ ] Style log panel (use existing modal/panel styles)
- [ ] Smoke test: import video → check log appears

## Phase 2 — Export queue manager UI
- [ ] Add UI panel that lists EXPORT_FINAL jobs with status/progress
- [ ] Add buttons: cancel job, retry failed (if retry implemented)
- [ ] Ensure it stays updated via `job:updated`

## Phase 3 — Professional polish
- [ ] Improve onboarding step UI based on pipeline state
- [ ] Improve empty states (project/clip/candidate)
- [ ] Add release notes modal on update

