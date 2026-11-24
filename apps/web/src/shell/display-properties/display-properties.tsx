// Display Properties: the stage's settings, kept in memory for now.
import { Button } from '../../ui/button/button.tsx'
import { Check } from '../../ui/check/check.tsx'
import { GroupBox } from '../../ui/group-box/group-box.tsx'
import { Select } from '../../ui/select/select.tsx'
import { Tabs } from '../../ui/tabs/tabs.tsx'
import type { Settings } from '../shell/types.ts'
import { RESOLUTIONS } from '../stage/stage-scale.ts'
import styles from './display-properties.module.css'

export interface DisplayPropertiesProps {
  settings: Settings
  scale: number
  /** How the screen is shown right now. */
  layout: 'monitor' | 'bare' | 'phone'
  prefersReducedMotion: boolean
  onChange: (settings: Settings) => void
  onClose: () => void
}

const SHOWN: Record<DisplayPropertiesProps['layout'], (scale: number) => string> = {
  monitor: (scale) => `Shown at ${scale}× on the monitor.`,
  bare: () => 'This browser window is too small for the monitor, so the screen is shown bare.',
  phone: () => 'This browser window is too small for the desktop.',
}

function BuzzSetting(props: DisplayPropertiesProps) {
  // On a phone a buzz vibrates, which isn't motion on screen, so reduced motion doesn't gate it.
  if (props.layout === 'phone')
    return (
      <GroupBox legend="Buzz">
        <div class={styles.stack}>
          <Check
            label="&Vibrate when a buzz arrives"
            checked={props.settings.shakeOnBuzz}
            onChange={(shakeOnBuzz) => props.onChange({ ...props.settings, shakeOnBuzz })}
            description="Phones that can't vibrate shake the screen instead. When this is off, the title bar flashes."
          />
        </div>
      </GroupBox>
    )
  return (
    <GroupBox legend="Buzz">
      <div class={styles.stack}>
        <Check
          label="&Shake a window when a buzz arrives"
          checked={props.settings.shakeOnBuzz && !props.prefersReducedMotion}
          disabled={props.prefersReducedMotion}
          onChange={(shakeOnBuzz) => props.onChange({ ...props.settings, shakeOnBuzz })}
          description={
            props.prefersReducedMotion
              ? 'Your system asks for less motion, so the title bar flashes instead.'
              : 'When this is off, the title bar flashes instead.'
          }
        />
      </div>
    </GroupBox>
  )
}

/** The Pocket's settings: its own screen, and the buzz (decision 0019). */
function PocketSettings(props: DisplayPropertiesProps) {
  return (
    <div class={`${styles.displayProperties} ${styles.pocket}`}>
      <GroupBox legend="Screen">
        <div class={styles.stack}>
          <Check
            label="&LCD effect"
            checked={props.settings.lcdEffect}
            onChange={(lcdEffect) => props.onChange({ ...props.settings, lcdEffect })}
            description={
              <>
                A faint pixel grid and backlight, like a 2003 handheld. Turn it off for a plain
                screen.
              </>
            }
          />
        </div>
      </GroupBox>
      <BuzzSetting {...props} />
      <div class={styles.buttons}>
        <Button label="OK" isDefault onClick={props.onClose} class={styles.wide} />
      </div>
    </div>
  )
}

export function DisplayProperties(props: DisplayPropertiesProps) {
  if (props.layout === 'phone') return <PocketSettings {...props} />
  return (
    <div class={styles.displayProperties}>
      <Tabs
        label="Display Properties"
        tabs={[
          {
            id: 'display',
            label: 'Display',
            content: () => (
              <div class={styles.stack}>
                <GroupBox legend="Screen resolution">
                  <div class={styles.stack}>
                    <Select
                      label="&Resolution:"
                      options={RESOLUTIONS.map((option) => ({
                        value: option.id,
                        label: `${option.width} by ${option.height} pixels`,
                      }))}
                      value={props.settings.resolution}
                      onChange={(value) => {
                        const picked = RESOLUTIONS.find((option) => option.id === value)
                        if (picked !== undefined) {
                          props.onChange({ ...props.settings, resolution: picked.id })
                        }
                      }}
                    />
                    <p class={`${styles.plain} ${styles.muted}`}>
                      {SHOWN[props.layout](props.scale)}
                    </p>
                  </div>
                </GroupBox>
                <GroupBox legend="Monitor">
                  <div class={styles.stack}>
                    <Check
                      label="&CRT effect"
                      checked={props.settings.crtEffect}
                      onChange={(crtEffect) => props.onChange({ ...props.settings, crtEffect })}
                      description={
                        <>
                          A curved tube, colour fringing, scanlines and glow, run live on the
                          screen. Turn it off for sharp pixels or a slow computer.
                        </>
                      }
                    />
                  </div>
                </GroupBox>
                <GroupBox legend="Pixels">
                  <div class={styles.stack}>
                    <Check
                      label="&Pixel mode"
                      checked={props.settings.pixelMode}
                      disabled={props.scale !== 2 || props.settings.crtEffect}
                      onChange={(pixelMode) => props.onChange({ ...props.settings, pixelMode })}
                      description={
                        <>
                          Keeps one pixel of every 2×2 block, so text looks as sharp as it did at
                          1×. Only at 2×, with the CRT effect off.
                        </>
                      }
                    />
                  </div>
                </GroupBox>
              </div>
            ),
          },
          {
            id: 'effects',
            label: 'Effects',
            content: () => <BuzzSetting {...props} />,
          },
        ]}
      />
      <div class={styles.buttons}>
        <Button label="OK" isDefault onClick={props.onClose} />
      </div>
    </div>
  )
}
