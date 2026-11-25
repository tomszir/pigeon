// Explorer's own pages for what it can't show: an address nobody is hosting, and a page over the
// dial-up budget. Drawn by Explorer, not loaded, so they need no sandbox.
import type { JSX } from 'solid-js'
import { Button } from '../../../ui/button/button.tsx'
import { type Icon, tangoIcon } from '../../../ui/icons/icons.ts'
import styles from './error-page.module.css'

function ErrorPage(props: {
  icon: Icon
  heading: string
  children: JSX.Element
  code: string
  onRefresh: () => void
  onHome: () => void
}) {
  return (
    <div class={styles.page} data-selectable>
      <img
        class={styles.icon}
        src={props.icon.src}
        alt=""
        width={props.icon.size}
        height={props.icon.size}
      />
      <div class={styles.body}>
        <h1 class={styles.heading}>{props.heading}</h1>
        {props.children}
        <div class={styles.buttons}>
          <Button label="&Retry" onClick={props.onRefresh} />
          <Button label="Home Pa&ge" onClick={props.onHome} />
        </div>
        <p class={styles.code}>{props.code}</p>
      </div>
    </div>
  )
}

export interface ErrorPageProps {
  address: string
  onRefresh: () => void
  onHome: () => void
}

/** Nobody who keeps a copy of the page is online. Until M5 nobody hosts anything, honestly so. */
export function NotHosted(props: ErrorPageProps) {
  return (
    <ErrorPage
      icon={tangoIcon('dialog-information', 32)}
      heading="This page isn't being hosted right now"
      code="PGN_NO_PEERS: nobody hosting this page is online"
      onRefresh={props.onRefresh}
      onHome={props.onHome}
    >
      <p>
        Nobody who keeps a copy of <strong class={styles.address}>{props.address}</strong> is online
        at the moment. On the Pigeonweb, pages live on the computers of their owner and the friends
        who mirror them, so a page is only up while one of them has Pigeon open.
      </p>
      <hr class={styles.rule} />
      <p>
        <strong>Please try the following:</strong>
      </p>
      <ul class={styles.list}>
        <li>Click Retry, or try again later.</li>
        <li>Check the address is spelled the way its owner gave it to you.</li>
        <li>Go back to your Home Page, which lives on this computer and is always here.</li>
      </ul>
    </ErrorPage>
  )
}

const kilobytes = (bytes: number) => `${Math.ceil(bytes / 1024)} KB`

/** The page is bigger than the dial-up budget, so Explorer won't open it. */
export function TooBig(props: ErrorPageProps & { bytes: number; budget: number }) {
  return (
    <ErrorPage
      icon={tangoIcon('dialog-warning', 32)}
      heading="This page is too big to open"
      code={`PGN_TOO_BIG: ${kilobytes(props.bytes)} of ${kilobytes(props.budget)}`}
      onRefresh={props.onRefresh}
      onHome={props.onHome}
    >
      <p>
        <strong class={styles.address}>{props.address}</strong> is {kilobytes(props.bytes)}.
        Pigeonweb pages are kept under {kilobytes(props.budget)}, pictures and all, so they arrive
        quickly over a dial-up line and friends can mirror them without filling their computers.
      </p>
      <hr class={styles.rule} />
      <p>If this is your page, make it smaller and try again.</p>
    </ErrorPage>
  )
}
