// Entry point: register the background tasks before the app (expo-router) starts.
import { Platform } from 'react-native';

import './src/notify/task';

if (Platform.OS === 'android') {
  // the "My team" home-screen widget (rendered by Android without the app open)
  const { registerWidgetTaskHandler } = require('react-native-android-widget');
  const { widgetTaskHandler } = require('./src/widget/handler');
  registerWidgetTaskHandler(widgetTaskHandler);
}

require('expo-router/entry');
