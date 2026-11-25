import hills800 from '../../wallpapers/hills-800x600.jpg'
import hills1024 from '../../wallpapers/hills-1024x768.jpg'
import hills1280 from '../../wallpapers/hills-1280x1024.jpg'
import type { Resolution, ResolutionId } from '../stage/stage-scale.ts'
import styles from './wallpaper.module.css'

/** One crop of the photo per resolution, so it is always one image pixel per screen pixel. */
const photos: Record<ResolutionId, string> = {
  '800x600': hills800,
  '1024x768': hills1024,
  '1280x1024': hills1280,
}

/** The desktop wallpaper: a photo of rolling hills from Unsplash. */
export function Wallpaper(props: { screen: Resolution }) {
  return (
    <div
      class={styles.wallpaper}
      aria-hidden="true"
      style={{
        'background-image': `url("${photos[props.screen.id]}")`,
        'background-size': `${props.screen.width}px ${props.screen.height}px`,
      }}
    />
  )
}
