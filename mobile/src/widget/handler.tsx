/** Android widget task: render "My team" when the widget is added, resized or updated (every 30 minutes). */
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { readJSON } from '@/lib/storage';

import { loadWidgetState } from './data';
import { MyTeamWidget } from './MyTeamWidget';

export const WIDGET_NAME = 'MyTeam';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
  const s = await loadWidgetState(await readJSON('prefs:v2'));
  props.renderWidget(<MyTeamWidget s={s} />);
}

/** Refresh the widget from inside the app (on launch, when the team changes, and during live tracking). */
export async function updateMyTeamWidget() {
  try {
    await requestWidgetUpdate({
      widgetName: WIDGET_NAME,
      renderWidget: async () => <MyTeamWidget s={await loadWidgetState(await readJSON('prefs:v2'))} />,
      widgetNotFound: () => undefined,
    });
  } catch {
    // no widget on the home screen, or not Android: nothing to do
  }
}
