/**
 * Remote-control / keyboard spatial navigation for Smart TVs.
 *
 * - Arrow keys move focus between [data-nav] elements (nearest in that direction).
 * - Enter/Space activates the focused element.
 * - Backspace/Escape/keycode 461 dispatches a `tv-back` event (modals handle it).
 * - When an element with [data-modal="true"] is open, navigation is scoped to it.
 */

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width < 6 || rect.height < 6) return false
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
  const style = getComputedStyle(el)
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0
}

type Direction = 'up' | 'down' | 'left' | 'right'

function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function findNext(current: HTMLElement, direction: Direction, scope: ParentNode): HTMLElement | null {
  const currentRect = current.getBoundingClientRect()
  if (currentRect.width === 0) return null
  const c = center(currentRect)
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>('[data-nav]')).filter(
    (el) => el !== current && isVisible(el) && !el.hasAttribute('data-nav-disabled'),
  )

  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const el of nodes) {
    const rect = el.getBoundingClientRect()
    const p = center(rect)
    const dx = p.x - c.x
    const dy = p.y - c.y

    let primary = 0
    let secondary = 0
    if (direction === 'left') {
      if (dx > -8) continue
      primary = -dx
      secondary = Math.abs(dy)
    } else if (direction === 'right') {
      if (dx < 8) continue
      primary = dx
      secondary = Math.abs(dy)
    } else if (direction === 'up') {
      if (dy > -8) continue
      primary = -dy
      secondary = Math.abs(dx)
    } else {
      if (dy < 8) continue
      primary = dy
      secondary = Math.abs(dx)
    }

    // Reward alignment on the perpendicular axis.
    const overlap =
      direction === 'left' || direction === 'right'
        ? Math.max(0, Math.min(rect.bottom, currentRect.bottom) - Math.max(rect.top, currentRect.top))
        : Math.max(0, Math.min(rect.right, currentRect.right) - Math.max(rect.left, currentRect.left))
    const overlapBonus = overlap > 0 ? 0 : Math.min(300, secondary)

    const score = primary + secondary * 1.35 + overlapBonus
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }

  return best
}

function handleKey(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (event.altKey || event.ctrlKey || event.metaKey) return

  const key = event.key
  const isBackKey = key === 'Escape' || key === 'Backspace' || key === 'GoBack' || key === 'BrowserBack'

  if (isBackKey && !isEditable(document.activeElement)) {
    event.preventDefault()
    document.dispatchEvent(new CustomEvent('tv-back'))
    return
  }

  if (isEditable(document.activeElement)) {
    if (key === 'Escape') {
      event.preventDefault()
      ;(document.activeElement as HTMLElement).blur()
    }
    return
  }

  const directionMap: Record<string, Direction> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }
  const direction = directionMap[key]

  const modal = document.querySelector<HTMLElement>('[data-modal="true"]')
  const scope: ParentNode = modal || document

  if (direction) {
    event.preventDefault()
    const active = document.activeElement as HTMLElement | null
    const current =
      active && active.matches('[data-nav]') && isVisible(active)
        ? active
        : (scope.querySelector<HTMLElement>('[data-nav]') as HTMLElement | null)

    if (!current) {
      const first = scope.querySelector<HTMLElement>('[data-nav]')
      first?.focus()
      return
    }

    const next = findNext(current, direction, scope)
    if (next) {
      next.focus({ preventScroll: false })
      next.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' })
    }
    return
  }

  if (key === 'Enter') {
    const active = document.activeElement as HTMLElement | null
    if (active?.matches('[data-nav]') && !['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
      event.preventDefault()
      active.click()
    }
  }
}

export function installSpatialNav(): () => void {
  window.addEventListener('keydown', handleKey)
  return () => window.removeEventListener('keydown', handleKey)
}

export function focusFirst(selector = '[data-nav]') {
  requestAnimationFrame(() => {
    const modal = document.querySelector<HTMLElement>('[data-modal="true"]')
    const el = (modal || document).querySelector<HTMLElement>(selector)
    el?.focus()
  })
}
