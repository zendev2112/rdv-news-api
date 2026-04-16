// Entry point used by src/app.js to start the cron scheduler.
// All schedule logic lives in scheduler.js.
import './scheduler.js'

export function startJobs() {
  // scheduler.js registers all cron jobs on import — nothing else needed here.
  console.log('✅ Cron jobs registered via scheduler.js')
}
