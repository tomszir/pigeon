// Every page of in-world Help, by its pigeon://help address. Each is a plain PigeonHTML file
// that Explorer serves from this computer and sanitizes like anyone's page (docs/pigeonhtml.md).

import addingAFriend from './how/adding-a-friend.html?raw'
import comingSoon from './how/coming-soon.html?raw'
import onePicture from './how/index.html?raw'
import privateRooms from './how/private-rooms.html?raw'
import recoveryKey from './how/recovery-key.html?raw'
import savingYourData from './how/saving-your-data.html?raw'
import yourDevices from './how/your-devices.html?raw'
import contents from './index.html?raw'

/** Help's contents page. Every Help address starts with it. */
export const HELP_HOME = 'pigeon://help/'

export interface HelpPage {
  readonly title: string
  /** PigeonHTML: HTML 4.01 with presentational attributes, CSS 2.1, no scripts. */
  readonly source: string
}

const HOW_HOME = `${HELP_HOME}how/`
const how = (title: string) => `${title} - How Pigeon Works`

export const HELP_PAGES: ReadonlyMap<string, HelpPage> = new Map<string, HelpPage>([
  [HELP_HOME, { title: 'Pigeon Help', source: contents }],
  [HOW_HOME, { title: how('Pigeon in One Picture'), source: onePicture }],
  [`${HOW_HOME}adding-a-friend`, { title: how('Adding a Friend'), source: addingAFriend }],
  [`${HOW_HOME}private-rooms`, { title: how('Your Private Rooms'), source: privateRooms }],
  [`${HOW_HOME}your-devices`, { title: how('Your Devices'), source: yourDevices }],
  [`${HOW_HOME}recovery-key`, { title: how('Your Recovery Key'), source: recoveryKey }],
  [`${HOW_HOME}saving-your-data`, { title: how('Saving Your Data'), source: savingYourData }],
  [`${HOW_HOME}coming-soon`, { title: how('Coming Soon'), source: comingSoon }],
])
