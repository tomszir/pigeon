import { render } from 'solid-js/web'
import '../ui/tokens.css'
import { createShell } from '../shell/shell/shell.tsx'
import { tangoIcon } from '../ui/icons/icons.ts'
import { createBrowserEnv, loadFonts } from './browser-env.ts'
import { createPrograms } from './programs.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html is missing #root')

await loadFonts()

render(() => {
  const env = createBrowserEnv()
  const { api, Shell } = createShell(env)
  // ?demo opens the Desktop board's sample conversation (docs/roadmap.md, M1).
  const sample = new URLSearchParams(window.location.search).has('demo')
  const programs = createPrograms(api, env, sample)

  programs.openReadme()
  if (sample) {
    programs.openMessenger()
    programs.openConversation('mika')
  }
  api.notify({
    title: 'Welcome to Pigeon',
    icon: tangoIcon('dialog-information', 16),
    body: 'Have a look at Read Me.txt first. Pigeon works offline for now.',
  })

  return <Shell {...programs} />
}, root)
