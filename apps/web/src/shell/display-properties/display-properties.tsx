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

export function DisplayProperties(props: DisplayPropertiesProps) {
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
                    />
                    <p class={`${styles.plain} ${styles.muted}`}>
                      A curved tube, colour fringing, scanlines and glow, run live on the screen.
                      Turn it off for sharp pixels or a slow computer.
                    </p>
                  </div>
                </GroupBox>
                <GroupBox legend="Pixels">
                  <div class={styles.stack}>
                    <Check
                      label="&Pixel mode"
                      checked={props.settings.pixelMode}
                      disabled={props.scale !== 2 || props.settings.crtEffect}
                      onChange={(pixelMode) => props.onChange({ ...props.settings, pixelMode })}
                    />
                    <p class={`${styles.plain} ${styles.muted}`}>
                      Keeps one pixel of every 2×2 block, so text looks as sharp as it did at 1×.
                      Only at 2×, with the CRT effect off.
                    </p>
                  </div>
                </GroupBox>
              </div>
            ),
          },
          {
            id: 'effects',
            label: 'Effects',
            content: () => (
              <GroupBox legend="Buzz">
                <div class={styles.stack}>
                  <Check
                    label="&Shake a window when a buzz arrives"
                    checked={props.settings.shakeOnBuzz && !props.prefersReducedMotion}
                    disabled={props.prefersReducedMotion}
                    onChange={(shakeOnBuzz) => props.onChange({ ...props.settings, shakeOnBuzz })}
                  />
                  <p class={`${styles.plain} ${styles.muted}`}>
                    {props.prefersReducedMotion
                      ? 'Your system asks for less motion, so the title bar flashes instead.'
                      : 'When this is off, the title bar flashes instead.'}
                  </p>
                </div>
              </GroupBox>
            ),
          },
        ]}
      />
      <div class={styles.buttons}>
        <Button label="OK" isDefault onClick={props.onClose} />
      </div>
    </div>
  )
}
