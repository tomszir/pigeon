// About Pigeon: version, links, and the credits the asset licences ask for (decision 0007).
import { For } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { brand } from '../../../ui/icons/icons.ts'
import styles from './about.module.css'

export const SITE_URL = 'https://pigeon.tomszir.com'
export const SOURCE_URL = 'https://github.com/tomszir/pigeon'

export const WALLPAPER_PHOTOGRAPHER_URL = 'https://unsplash.com/@bchen22'

const credits = [
  {
    what: 'Control styling and title-bar buttons',
    who: 'XP.css',
    href: 'https://github.com/botoxparty/XP.css',
    licence: 'MIT',
  },
  {
    what: 'Tahoma clone',
    who: 'the Wine project',
    href: 'https://www.winehq.org/',
    licence: 'LGPL 2.1',
  },
  {
    what: 'Monospace font',
    who: 'Bitstream Vera',
    href: 'https://download.gnome.org/sources/ttf-bitstream-vera/',
    licence: 'Bitstream Vera licence',
  },
  {
    what: 'Icons',
    who: 'the Tango Desktop Project',
    href: 'http://tango.freedesktop.org/',
    licence: 'public domain',
  },
  {
    what: 'Wallpaper',
    who: 'photo by @bchen22 on Unsplash',
    href: WALLPAPER_PHOTOGRAPHER_URL,
    licence: 'Unsplash License',
  },
] as const

export function About(props: { onClose: () => void }) {
  return (
    <div class={styles.about}>
      <div class={styles.head}>
        <img src={brand('pigeon-128')} alt="" width="64" height="64" class={styles.logo} />
        <div>
          <p class={styles.name}>Pigeon</p>
          <p class={styles.plain}>
            Version {__PIGEON_VERSION__}
            {__PIGEON_COMMIT__ === '' ? '' : ` (build ${__PIGEON_COMMIT__})`}
          </p>
          <p class={styles.plain}>
            <a href={SITE_URL} target="_blank" rel="noopener">
              pigeon.tomszir.com
            </a>
            {' · '}
            <a href={SOURCE_URL} target="_blank" rel="noopener">
              source code
            </a>
          </p>
        </div>
      </div>
      <div class={styles.rule} aria-hidden="true" />
      <ul class={styles.credits}>
        <For each={credits}>
          {(credit) => (
            <li>
              {credit.what}:{' '}
              <a href={credit.href} target="_blank" rel="noopener">
                {credit.who}
              </a>{' '}
              ({credit.licence})
            </li>
          )}
        </For>
      </ul>
      <p class={`${styles.plain} ${styles.muted}`}>Not affiliated with or endorsed by Microsoft.</p>
      <div class={styles.buttons}>
        <Button label="OK" isDefault onClick={props.onClose} />
      </div>
    </div>
  )
}
