/**
 * Background task definition. It must be registered at app start-up, before any screen,
 * so the entry file (index.js) imports this module first.
 */
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { ALERT_TASK, NOTIFY_SUPPORTED, runAlertCheck } from './notifications';

if (NOTIFY_SUPPORTED) {
  TaskManager.defineTask(ALERT_TASK, async () => {
    try {
      await runAlertCheck();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}
