/**
 * dsh-session-continue — browser half.
 *
 * Contributes two surfaces:
 *
 *  - `conversation.input.dock` — the full-width seat directly above the composer
 *    card. When the Host's `sessionContinueInterruption` projection reports that
 *    this Session ended abnormally, it renders a notice with a Continue button.
 *  - `plugins.bundle.config` — the preferences the notice reads, rendered on this
 *    plugin's own Plugins detail page rather than as a Settings section of their
 *    own. A plugin with two switches does not deserve a sidebar entry.
 *
 * The preferences are stored in `localStorage` so they survive reloads and apply
 * immediately in the page: one tiny observable is shared by both surfaces, so a
 * toggle in settings changes the notice without a reload.
 *
 * @module dsh-session-continue/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-continue',
  factory(require) {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'sessionContinue'
    /**
     * This package's name.
     *
     * It is the key the Plugins page dispatches for a bundle's own configuration,
     * so it is the one identifier this half must know. It deliberately does NOT
     * carry a version: the page draws the version tag from the manifest, so a copy
     * here could only ever go stale.
     */
    const PACKAGE_ID = 'dsh-session-continue'
    /** Projection key registered by this plugin's Host half. */
    const PROJECTION_KEY = 'sessionContinueInterruption'
    /** Dock cell id; a fresh id adds an entry beside the shipped todo/goal/queue docks. */
    const DOCK_ID = 'sessionContinue-interrupted'
    /** localStorage key for the preference switches. */
    const SWITCH_KEY = 'dsh-session-continue:switches'

    /**
     * The preferences this plugin exposes.
     *
     * The plugin's own on/off switch is NOT here: that lives on the plugin's row
     * in the plugin manager, which already owns enabling and disabling. This page
     * carries only the preferences that sit on top of being enabled.
     */
    const PREFERENCES = [
      {
        key: 'progressRestore',
        label: 'switch.progressRestore',
        desc: 'switch.progressRestore.desc',
      },
      {
        key: 'notifyUserAbort',
        label: 'switch.notifyUserAbort',
        desc: 'switch.notifyUserAbort.desc',
      },
    ]

    /** Default value per preference switch. */
    const SWITCH_DEFAULTS = {
      progressRestore: true,
      // On: a Stop you pressed is reported too, because it can still leave work
      // unfinished. Off: only endings you did not choose are reported.
      notifyUserAbort: true,
    }

    /** Read the persisted switch map, falling back to defaults field by field. */
    function readSwitches() {
      const next = { ...SWITCH_DEFAULTS }
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SWITCH_KEY)
        if (raw === null) return next
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return next
        for (const key of Object.keys(SWITCH_DEFAULTS)) {
          if (typeof parsed[key] === 'boolean') next[key] = parsed[key]
        }
      } catch {
        // A corrupted or unavailable store is not worth failing the UI over.
      }
      return next
    }

    /**
     * The one switch store both surfaces read.
     *
     * A tiny observable keeps the dock and the settings page in sync: toggling in
     * settings updates the notice immediately, with no reload.
     */
    const store = {
      value: readSwitches(),
      listeners: new Set(),
      getSnapshot: () => store.value,
      subscribe(listener) {
        store.listeners.add(listener)
        return () => {
          store.listeners.delete(listener)
        }
      },
      set(key, enabled) {
        if (store.value[key] === enabled) return
        store.value = { ...store.value, [key]: enabled }
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(SWITCH_KEY, JSON.stringify(store.value))
        } catch {
          // Persisting is best-effort; the live value still applies.
        }
        for (const listener of [...store.listeners]) listener()
      },
    }

    /** Subscribe one component to the switch store. */
    function useSwitches() {
      const [value, setValue] = useState(store.getSnapshot)
      useEffect(() => store.subscribe(() => setValue(store.getSnapshot())), [])
      return value
    }

    /** Styles inherit the host theme: only `--dsw-alias-*` tokens are referenced. */
    const CSS = `
.sc-root {
  box-sizing: border-box;
  width: calc(100% - 2 * var(--dsh-composer-side-clearance) - 4 * var(--dsh-composer-dock-inset));
  max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));
  margin: 0 auto;
}
.sc-card {
  isolation: isolate;
  position: relative;
  display: flex;
  /* Collapsed: the one-line notice centers as a whole, so the text and the
     buttons share a baseline instead of the text riding high. */
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--dsw-radius-lg, 10px);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-panel);
}
/* Expanded: the body grows downward from the title, so both columns anchor to
   the top and the buttons stay level with the title line rather than drifting
   into the middle of the details. */
.sc-card[data-expanded="true"] { align-items: flex-start; }
.sc-card::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  border-radius: inherit;
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
}
.sc-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
/* Collapsed: sc-main holds a single row; matching the button height keeps the
   whole notice on one optical line instead of the text sitting above center. */
.sc-card:not([data-expanded="true"]) .sc-main { justify-content: center; }
.sc-titleRow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sc-dot {
  flex: none; width: 8px; height: 8px; border-radius: 999px;
  background: var(--dsw-alias-state-warn-primary);
}
.sc-dot[data-severity="error"] { background: var(--dsw-alias-state-error-primary); }
.sc-title {
  flex: none; font-size: 13px; font-weight: 500; line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.sc-reason {
  min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; line-height: 22px; color: var(--dsw-alias-label-secondary);
}
/* Buttons follow the card's cross-axis rule instead of centering themselves, so
   the collapsed notice stays level and the expanded one anchors to the title. */
.sc-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.sc-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 30px; padding: 0 12px; border: 0;
  border-radius: var(--dsw-radius-md, 8px);
  font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; white-space: nowrap;
}
.sc-button[data-variant="primary"] { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.sc-button[data-variant="primary"]:hover:not(:disabled) { filter: brightness(1.06); }
.sc-button[data-variant="ghost"] { background: transparent; color: var(--dsw-alias-label-secondary); }
.sc-button[data-variant="ghost"]:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-primary);
}
/* The design system's disabled value for buttons is .4; .5 is for switches. */
.sc-button:disabled { opacity: .4; cursor: default; }
.sc-button:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sc-note { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sc-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.sc-note[data-tone="success"] { color: var(--dsw-alias-state-success-primary); }

/* Collapsed notice keeps exactly one explanatory line; everything else lives
   behind the Details toggle so a crashed Session does not shout at the user.
   No separator line: the panel sits on the card's own surface, and a hairline
   there would cut the notice into two boxes inside one card. */
.sc-details {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sc-detailRow { display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 18px; }
.sc-detailLabel { flex: none; width: 66px; color: var(--dsw-alias-label-secondary); }
.sc-detailValue { min-width: 0; flex: 1; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.sc-detailValue[data-mono="true"] {
  /* The host's own code stack, which the user can override in Settings. Writing a
     font stack inline here would ignore that choice. */
  font-family: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11.5px;
}
.sc-button[aria-expanded="true"] { color: var(--dsw-alias-label-primary); }
.sc-button[data-variant="ghost"][aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
}

/* This block is the BODY of the plugin's detail page, so it brings no heading of
   its own: the page draws the title, the icon, the package name and the version
   tag. Repeating them here would print the same identity twice on one screen. */
.sc-page { display: flex; flex-direction: column; gap: 4px; }
/* The row list: no fill, no card, no shadow. Grouping here is the hairline between
   rows and nothing else, which is what makes it read as the host's own list. */
.sc-rows { display: flex; flex-direction: column; }
/* A settings row: 16px of vertical rhythm per row and one hairline between them.
   The colour pair is the measured one — 14/22 for the thing itself, 12/18 for
   what explains it. */
.sc-row {
  display: flex; align-items: center; gap: 8px;
  padding: 16px 0; border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.sc-row:last-child { border-bottom: 0; }
/* padding-right instead of space-between: it stops a long description from
   running under the control while keeping the control optically close. */
.sc-rowText { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; padding-right: 48px; }
.sc-rowLabel { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.sc-rowDesc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
/* The measured switch: a 36x20 track, a 16px thumb inset 2px, and exactly the
   travel that keeps the thumb inside the track. */
.sc-switch {
  flex: none; position: relative; width: 36px; height: 20px; padding: 0;
  border: 0; border-radius: 999px; cursor: pointer;
  background: var(--dsw-alias-border-l3, var(--dsw-alias-bg-layer-2));
  transition: background .15s ease;
}
.sc-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.sc-switch::after {
  content: ""; position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px; border-radius: 999px;
  background: var(--dsw-alias-bg-base);
  transition: transform .15s ease;
}
.sc-switch[aria-checked="true"]::after { transform: translateX(16px); }
.sc-switch:focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.sc-switch:disabled { opacity: .45; cursor: default; }
`

    /** Render the plugin stylesheet as a React element so unmounting removes it. */
    function Styles() {
      return h('style', { 'data-session-continue': 'styles' }, CSS)
    }

    /**
     * Build the continue instruction from the interruption view.
     *
     * Progress and the todo list travel inside the message because the Host's
     * `todos` projection clears on the next `turn/start`: once this message opens
     * a new turn, the model would no longer see the plan it was following.
     *
     * Progress is only attached when the plan is actually unfinished. A list whose
     * every item is completed carries nothing to resume, so pasting it would just
     * spend context restating finished work.
     *
     * @param view - the `sessionContinueInterruption` projection value.
     * @param t - translator for this plugin's namespace.
     * @param withProgress - whether to attach the detected progress.
     * @returns the message text.
     */
    function buildContinueText(view, t, withProgress) {
      const lines = [t('continue.instruction')]
      const todos = Array.isArray(view.todos) ? view.todos : []
      const unfinished = todos.filter((todo) => todo.status !== 'completed')

      // Nothing left to resume: the instruction alone is the whole message.
      if (!withProgress || (todos.length > 0 && unfinished.length === 0)) return lines.join('\n')

      if (view.turn > 0) lines.push(t('continue.progress', { turn: view.turn }))
      if (unfinished.length > 0) {
        lines.push(t('continue.todosHead'))
        for (const todo of todos) {
          const label =
            todo.status === 'completed'
              ? t('todo.completed')
              : todo.status === 'in_progress'
                ? t('todo.inProgress')
                : t('todo.pending')
          lines.push(`- [${label}] ${todo.content}`)
        }
      }
      return lines.join('\n')
    }

    /**
     * Decide what the dock renders for one projection value.
     *
     * Every ending that is not a clean completion gets a notice, because any of
     * them can leave work unfinished. The brief line carries the *reason*; the
     * detail rows behind the Details toggle carry everything else, so the
     * collapsed notice stays one line no matter which ending it describes.
     *
     * `crash` and `interrupted` are two spellings of the same event: `crash` is
     * the live fold of an unbalanced turn, and `interrupted` also covers a turn
     * closed by the harness's repair marker or killed between steps by a shutdown.
     * Stored and live Sessions therefore report different statuses for the same
     * event, and both must show the notice.
     *
     * `status: 'none'` (a clean `completed` turn) is the only ending that renders
     * nothing.
     *
     * A Stop the user pressed themselves is reported only while `notifyUserAbort`
     * is on: it is the one ending the user already knows about, so it is the one
     * worth letting them silence.
     *
     * @param view - the `sessionContinueInterruption` projection value (may be undefined).
     * @param t - translator for this plugin's namespace.
     * @param switches - the preference switch map.
     * @returns `{ severity, reason }`, or null when there is nothing to report.
     */
    function describeInterruption(view, t, switches) {
      if (view === undefined || view === null || typeof view.status !== 'string') return null
      switch (view.status) {
        case 'none':
          return null
        case 'crash':
          return { severity: 'warn', reason: t('reason.crash') }
        case 'interrupted':
          return { severity: 'warn', reason: t('reason.interrupted') }
        case 'error':
          return { severity: 'error', reason: t('reason.error') }
        case 'max-tokens':
          return { severity: 'warn', reason: t('reason.maxTokens') }
        case 'blocked':
          return { severity: 'warn', reason: t('reason.blocked') }
        case 'aborted':
          // The Host only reports `aborted` for a turn the user actually stopped.
          if (switches?.notifyUserAbort === false) return null
          return { severity: 'warn', reason: t('reason.aborted') }
        default:
          return null
      }
    }

    /**
     * Build the label/value rows shown behind the Details toggle.
     *
     * The reason is stated exactly once, by `describeInterruption` in the
     * collapsed line. Everything here is a fact that line does NOT carry, so the
     * panel elaborates instead of restating — and because there is a single
     * source for the reason, the two views cannot contradict each other.
     *
     * Every row is always present. An absent value renders as an explicit "none"
     * rather than vanishing, so the panel has a stable shape: the reader can tell
     * "this ending had no error code" from "this panel does not show error codes".
     *
     * @param view - the `sessionContinueInterruption` projection value.
     * @param t - translator for this plugin's namespace.
     * @returns the labeled detail rows, in display order.
     */
    function buildDetailRows(view, t) {
      const isEmpty = (value) => value === null || value === undefined || value === ''
      const orNone = (value) => (isEmpty(value) ? t('detail.none') : String(value))

      const rows = [{ label: t('detail.turn'), value: view.turn > 0 ? String(view.turn) : t('detail.none') }]
      // Monospace is for reading an identifier. The "none" placeholder is prose,
      // so it takes the normal face like every other empty row.
      rows.push({ label: t('detail.errorCode'), value: orNone(view.errorCode), mono: !isEmpty(view.errorCode) })
      // The failure text is often a long provider payload; it stays out of the
      // one-line reason and appears here in full.
      rows.push({ label: t('detail.errorMessage'), value: orNone(view.errorMessage) })
      return rows
    }

    /**
     * The composer-dock entry.
     *
     * @param props - standard slot props (`useProjection`, `useSession`,
     *   `inputActions`, `sessionId`) plus `t` from the registration's locale.
     * @returns the notice, or null when there is nothing to resume.
     */
    function InterruptedDock(props) {
      const { useProjection, useSession, inputActions, t } = props
      const view = useProjection(PROJECTION_KEY)
      const running = useSession((state) => state.running)
      const switches = useSwitches()

      const [busy, setBusy] = useState(false)
      const [outcome, setOutcome] = useState(null)
      const [dismissed, setDismissed] = useState(null)
      const [expanded, setExpanded] = useState(false)
      /**
       * Which interruption the Continue button has already acted on.
       *
       * One interruption yields at most one continue message. Two clicks
       * dispatched before React re-renders would both see `busy === false` and
       * both submit, so the latch that actually stops that is a `ref`: it is
       * written synchronously and survives the render that follows.
       */
      const submittedRef = useRef(null)
      const [submitted, setSubmitted] = useState(null)

      // `switches` is a dependency: flipping `notifyUserAbort` must show or hide a
      // Stop notice immediately, without waiting for a new event.
      const notice = useMemo(() => describeInterruption(view, t, switches), [view, t, switches])

      // A dismissal applies to one exact interruption, not to the feature.
      const noticeKey = notice === null ? null : `${view.status}:${view.turn}`

      // A fresh interruption (or a cleared one) re-arms the notice collapsed,
      // and clears the submit latch together with everything else it describes.
      useEffect(() => {
        submittedRef.current = null
        setSubmitted(null)
        setDismissed(null)
        setOutcome(null)
        setBusy(false)
        setExpanded(false)
      }, [noticeKey])

      // Release the busy state once the resumed turn settles.
      useEffect(() => {
        if (busy && running !== true) setBusy(false)
      }, [busy, running])

      // Whether this plugin runs at all is the plugin manager's call, not a
      // preference: loaded means on. Only the preferences apply here. While the
      // agent is running the turn is open by definition, so the notice would be
      // wrong: it is meant for a Session left interrupted.
      const visible = notice !== null && noticeKey !== null && noticeKey !== dismissed && running !== true

      const onContinue = useCallback(() => {
        // Both guards matter: `busy` covers a click that lands after the re-render
        // that disabled the button, and `submittedRef` covers a second click that
        // lands in the same tick, i.e. before any re-render can happen at all.
        if (busy || submittedRef.current === noticeKey) return
        setBusy(true)
        setOutcome(null)
        try {
          const text = buildContinueText(view, t, switches.progressRestore)
          inputActions.setDraft(text)
          inputActions.submit()
          submittedRef.current = noticeKey
          setSubmitted(noticeKey)
          setOutcome({ tone: 'success', text: t('continue.sent') })
        } catch (failure) {
          // A failed submission must stay retryable: the latch is only armed once
          // the message is actually in the composer.
          const message = failure instanceof Error ? failure.message : String(failure)
          setOutcome({ tone: 'error', text: t('continue.failed', { message }) })
        } finally {
          setBusy(false)
        }
      }, [busy, inputActions, noticeKey, switches.progressRestore, t, view])

      const onDismiss = useCallback(() => {
        setDismissed(noticeKey)
      }, [noticeKey])

      const onToggleDetails = useCallback(() => {
        setExpanded((current) => !current)
      }, [])

      if (!visible) return null

      const detailRows = buildDetailRows(view, t)

      // Everything optional lives here, so the collapsed notice stays one line.
      //
      // The todo list is deliberately absent: the shipped conversation dock
      // already renders it directly above this notice, so repeating it here would
      // show the same plan twice on one screen.
      const detailBody =
        detailRows.length > 0
          ? h(
              'div',
              { className: 'sc-details', key: 'rows' },
              detailRows.map((row) =>
                h('div', { className: 'sc-detailRow', key: row.label }, [
                  h('span', { className: 'sc-detailLabel', key: 'label' }, row.label),
                  h(
                    'span',
                    { className: 'sc-detailValue', 'data-mono': row.mono ? 'true' : undefined, key: 'value' },
                    row.value,
                  ),
                ]),
              ),
            )
          : null

      return h(React.Fragment, null, [
        h(Styles, { key: 'styles' }),
        h(
          'div',
          { className: 'sc-root', 'data-session-continue': 'interrupted', key: 'root' },
          h('div', { className: 'sc-card', role: 'status', 'data-expanded': expanded ? 'true' : undefined }, [
            h('div', { className: 'sc-main', key: 'main' }, [
              h('div', { className: 'sc-titleRow', key: 'title' }, [
                h('span', { className: 'sc-dot', 'data-severity': notice.severity, 'aria-hidden': true, key: 'dot' }),
                h('span', { className: 'sc-title', key: 'label' }, t('title')),
                h('span', { className: 'sc-reason', title: notice.reason, key: 'reason' }, notice.reason),
              ]),
              // `id` is what the Details button's aria-controls points at, so the
              // relationship is real for assistive tech instead of a dangling id.
              expanded ? h('div', { key: 'body', id: 'sc-details' }, detailBody) : null,
              // No role="status" here: the card itself is the live region, so a
              // second one nested inside it would announce the same sentence twice.
              outcome === null
                ? null
                : h('div', { className: 'sc-note', 'data-tone': outcome.tone, key: 'outcome' }, outcome.text),
            ]),
            h('div', { className: 'sc-actions', key: 'actions' }, [
              h(
                'button',
                {
                  key: 'details',
                  type: 'button',
                  className: 'sc-button',
                  'data-variant': 'ghost',
                  'aria-expanded': expanded,
                  // Only while the body exists: an aria-controls pointing at an
                  // element that is not in the tree is a relationship to nothing.
                  'aria-controls': expanded ? 'sc-details' : undefined,
                  disabled: busy,
                  onClick: onToggleDetails,
                },
                expanded ? t('details.hide') : t('details.show'),
              ),
              h(
                'button',
                {
                  key: 'continue',
                  type: 'button',
                  className: 'sc-button',
                  'data-variant': 'primary',
                  disabled: busy || submitted === noticeKey,
                  'aria-busy': busy || undefined,
                  onClick: onContinue,
                },
                busy ? t('continue.busy') : submitted === noticeKey ? t('continue.done') : t('continue.label'),
              ),
              h(
                'button',
                {
                  key: 'dismiss',
                  type: 'button',
                  className: 'sc-button',
                  'data-variant': 'ghost',
                  disabled: busy,
                  onClick: onDismiss,
                },
                t('dismiss'),
              ),
            ]),
          ]),
        ),
      ])
    }

    /**
     * This bundle's own configuration, rendered on its Plugins detail page.
     *
     * The page already draws the title, the icon, the package name and the version
     * tag, so nothing here repeats them: this is the body between the description
     * and the row list, and it holds the preferences and nothing else.
     *
     * The page asks twice, for two different jobs:
     *
     *   - `view: 'summary'` is the one-liner, and only when the package carries no
     *     description of its own. It is plain text, not a control.
     *   - `view: 'page'` is the form itself.
     *
     * There is no save button: each switch is its own committed action, which is
     * what the host's row grammar expects from an on/off preference.
     *
     * @param props - `t` from the registration's locale namespace, plus the `view`
     *   the page asks for.
     * @returns the summary line or the preference rows.
     */
    function BundleConfig({ t, view }) {
      // The hook runs before the branch on purpose: the page can ask this same
      // entry for `summary` and then `page`, and a conditional hook would change
      // the call order between those two renders.
      const switches = useSwitches()
      if (view === 'summary') return t('settings.description')
      return h('div', { className: 'sc-page' }, [
        h(Styles, { key: 'styles' }),
        h(
          'div',
          { className: 'sc-rows', key: 'rows' },
          PREFERENCES.map((preference) =>
            h('div', { className: 'sc-row', key: preference.key }, [
              h(
                'div',
                { className: 'sc-rowText', key: 'text' },
                h('label', { className: 'sc-rowLabel', htmlFor: `sc-switch-${preference.key}`, key: 'label' }, t(preference.label)),
                h('span', { className: 'sc-rowDesc', key: 'desc' }, t(preference.desc)),
              ),
              h('button', {
                key: 'switch',
                id: `sc-switch-${preference.key}`,
                type: 'button',
                className: 'sc-switch',
                role: 'switch',
                'aria-checked': switches[preference.key] === true,
                'aria-label': t(preference.label),
                onClick: () => store.set(preference.key, switches[preference.key] !== true),
              }),
            ]),
          ),
        ),
      ])
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(
          () =>
            ctx.locale.register(NS, {
              zh: {
                title: '会话未正常结束',
                // Reason only — the title already says the session did not finish
                // cleanly, so repeating "the last run was…" here would restate it.
                'reason.crash': '进程异常退出',
                'reason.interrupted': '重启或连接中断',
                'reason.error': '任务执行出错',
                'reason.maxTokens': '输出达到长度上限',
                'reason.blocked': '任务被阻止',
                'reason.aborted': '被手动停止',
                'continue.label': '继续',
                'continue.busy': '继续中…',
                'continue.sent': '已填写继续指令',
                'continue.done': '已发送',
                'continue.failed': '继续失败：{message}',
                'continue.instruction': '上次会话未正常结束，检查进度，然后继续。',
                'continue.progress': '上次中断于第 {turn} 轮。',
                'continue.todosHead': '上次的任务清单：',
                'todo.completed': '已完成',
                'todo.inProgress': '进行中',
                'todo.pending': '待处理',
                dismiss: '忽略',
                'details.show': '详情',
                'details.hide': '收起',
                'detail.turn': '中断轮次',
                'detail.errorCode': '错误代码',
                'detail.errorMessage': '错误信息',
                'detail.none': '无',
                // The bundle's detail page draws the title, the package name and
                // the version tag, so this dictionary carries no copy for any of
                // them. This one line is the summary the page falls back to when
                // the package has no description of its own.
                'settings.description': '会话非正常结束时提示继续；这里是它的两个开关。',
                'switch.progressRestore': '恢复进度与任务清单',
                'switch.progressRestore.desc': '继续时附带未完成的任务清单，帮助模型准确接续。',
                'switch.notifyUserAbort': '提示手动停止的会话',
                'switch.notifyUserAbort.desc': '关闭后只提示非你主动结束的会话。',
              },
              en: {
                title: 'Session did not finish cleanly',
                // Reason only — the title already states the outcome.
                'reason.crash': 'the process exited unexpectedly',
                'reason.interrupted': 'a restart or lost connection',
                'reason.error': 'the task failed',
                'reason.maxTokens': 'the output limit was reached',
                'reason.blocked': 'the task was blocked',
                'reason.aborted': 'you stopped it manually',
                'continue.label': 'Continue',
                'continue.busy': 'Continuing…',
                'continue.sent': 'Continue instruction drafted',
                'continue.done': 'Sent',
                'continue.failed': 'Continue failed: {message}',
                'continue.instruction': 'The previous session did not finish cleanly. Check the progress, then continue.',
                'continue.progress': 'The interruption happened during turn {turn}.',
                'continue.todosHead': 'The task list at that point:',
                'todo.completed': 'done',
                'todo.inProgress': 'in progress',
                'todo.pending': 'pending',
                dismiss: 'Dismiss',
                'details.show': 'Details',
                'details.hide': 'Hide details',
                'detail.turn': 'Turn',
                'detail.errorCode': 'Error code',
                'detail.errorMessage': 'Error message',
                'detail.none': 'none',
                'settings.description': 'Notices an unfinished session and offers Continue; these are its two switches.',
                'switch.progressRestore': 'Restore progress and todo list',
                'switch.progressRestore.desc': 'Attach the unfinished todo list when continuing so the model resumes accurately.',
                'switch.notifyUserAbort': 'Report manually stopped sessions',
                'switch.notifyUserAbort.desc': 'When off, only sessions you did not stop yourself are reported.',
              },
            }),
          'dsh-session-continue: dictionaries',
        )

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: DOCK_ID,
              // Above the shipped todo dock (order 0) and the goal/queue docks.
              order: -10,
              locale: NS,
            },
            InterruptedDock,
          ),
        )

        // The key is the BUNDLE'S PACKAGE NAME: that is what the Plugins page
        // dispatches when it opens this bundle's own detail page. A row's page is
        // keyed `<package>#<row id>` instead; this plugin's preference block belongs
        // to the bundle, not to one row of it.
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.bundle.config',
              key: PACKAGE_ID,
              locale: NS,
            },
            BundleConfig,
          ),
        )
      },
    }
  },
})