import { useEffect, useRef, useState } from 'react'
import { focusFirst } from '../lib/nav'
import { useMemory } from '../lib/memory'
import { MAX_PROFILES } from '../lib/profiles'
import { EditIcon, PlusIcon, TrashIcon, UserIcon, XIcon } from './icons'

interface ProfilesPanelProps {
  open: boolean
  onClose: () => void
}

export function ProfilesPanel({ open, onClose }: ProfilesPanelProps) {
  const memory = useMemory()
  const inputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setError(null)
      setRenameId(null)
      setConfirmId(null)
      return
    }
    document.body.classList.add('modal-open')
    const onBack = () => onClose()
    document.addEventListener('tv-back', onBack)
    const timer = window.setTimeout(() => focusFirst('[data-people="true"] [data-nav]'), 80)
    return () => {
      window.clearTimeout(timer)
      document.body.classList.remove('modal-open')
      document.removeEventListener('tv-back', onBack)
    }
  }, [open, onClose])

  if (!open) return null

  const atLimit = memory.profiles.length >= MAX_PROFILES

  const add = () => {
    try {
      memory.addProfile(name)
      setName('')
      setError(null)
      inputRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add this person')
    }
  }

  const saveRename = (id: string) => {
    if (!renameValue.trim()) return
    memory.renameProfile(id, renameValue)
    setRenameId(null)
    setRenameValue('')
  }

  return (
    <div
      data-modal="true"
      data-people="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 p-3 md:items-center md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative my-auto w-full max-w-2xl animate-pop overflow-hidden rounded-3xl border border-white/10 bg-panel p-5 shadow-2xl md:p-7">
        <button
          type="button"
          data-nav
          onClick={onClose}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white/75 ring-1 ring-white/15 transition hover:bg-black/70 hover:text-white"
          aria-label="Close people panel"
        >
          <XIcon width={20} height={20} />
        </button>

        <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/35">Household</p>
        <h2 className="mt-1 flex items-center gap-2.5 text-2xl font-black tracking-tight">
          <UserIcon width={24} height={24} className="text-gold" />
          People
        </h2>
        <p className="mt-1 text-sm text-white/45">
          Everyone gets their own likes, history, wishlist and taste. Add a person, or rename/remove
          the ones you added.
        </p>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-white/40">Add someone new</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              data-nav
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
                if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
              }}
              maxLength={30}
              placeholder="Name (e.g. Fatima, Ahmed, Guest)"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="done"
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-base text-white placeholder:text-white/25 focus:border-gold/60"
            />
            <button
              type="button"
              data-nav
              disabled={!name.trim() || atLimit}
              onClick={add}
              className="btn-primary shrink-0"
            >
              <PlusIcon width={16} height={16} />
              Add person
            </button>
          </div>
          {atLimit ? (
            <p className="mt-2 text-xs text-amber-300/80">
              The limit is {MAX_PROFILES} people. Remove one to add another.
            </p>
          ) : null}
          {error ? <p className="mt-2 text-xs text-brand-soft">{error}</p> : null}
          <p className="mt-2 text-[0.68rem] text-white/25">
            Select the box and type with your TV remote. The AI will understand the new name too.
          </p>
        </div>

        <ul className="mt-4 max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
          {memory.profiles.map((p) => {
            const active = memory.profile === p.id
            const custom = !p.builtin
            const renaming = renameId === p.id
            const confirming = confirmId === p.id

            return (
              <li
                key={p.id}
                className={`rounded-2xl border p-2.5 ${
                  active ? 'border-gold/45 bg-gold/[0.07]' : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      active ? 'bg-gold text-black' : 'bg-white/10 text-white/60'
                    }`}
                  >
                    <UserIcon width={17} height={17} />
                  </span>

                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <input
                        data-nav
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            saveRename(p.id)
                          }
                          if (e.key === 'Escape') setRenameId(null)
                        }}
                        maxLength={30}
                        spellCheck={false}
                        autoComplete="off"
                        className="w-full rounded-lg border border-white/15 bg-black/50 px-3 py-1.5 text-sm font-bold text-white focus:border-gold/60"
                      />
                    ) : (
                      <p className="flex items-center gap-2 truncate text-sm font-bold text-white/90">
                        {p.name}
                        {active ? (
                          <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-gold">
                            Active
                          </span>
                        ) : null}
                      </p>
                    )}
                    <p className="text-[0.65rem] text-white/35">
                      {p.role}
                      {custom ? ' · Added by you' : ' · Built in'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {renaming ? (
                      <>
                        <button
                          type="button"
                          data-nav
                          onClick={() => saveRename(p.id)}
                          disabled={!renameValue.trim()}
                          className="btn-primary !px-3 !py-1.5 text-xs"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          data-nav
                          onClick={() => setRenameId(null)}
                          className="btn-ghost !px-3 !py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {!active ? (
                          <button
                            type="button"
                            data-nav
                            onClick={() => memory.setProfile(p.id)}
                            className="btn-soft !px-3 !py-1.5 text-xs"
                          >
                            Use
                          </button>
                        ) : null}

                        {custom ? (
                          confirmId === p.id ? (
                            <>
                              <button
                                type="button"
                                data-nav
                                onClick={async () => {
                                  await memory.removeProfile(p.id)
                                  setConfirmId(null)
                                }}
                                className="btn-primary !bg-brand !px-3 !py-1.5 text-xs"
                              >
                                Delete?
                              </button>
                              <button
                                type="button"
                                data-nav
                                onClick={() => setConfirmId(null)}
                                className="btn-ghost !px-3 !py-1.5 text-xs"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                data-nav
                                onClick={() => {
                                  setRenameId(p.id)
                                  setRenameValue(p.name)
                                  setConfirmId(null)
                                }}
                                className="btn-ghost !px-2.5 !py-1.5 text-xs"
                                title={`Rename ${p.name}`}
                              >
                                <EditIcon width={14} height={14} />
                                Rename
                              </button>
                              <button
                                type="button"
                                data-nav
                                onClick={() => setConfirmId(p.id)}
                                className="btn-ghost !px-2.5 !py-1.5 text-xs !text-white/40 hover:!text-brand-soft"
                                title={`Delete ${p.name}`}
                              >
                                <TrashIcon width={14} height={14} />
                                Delete
                              </button>
                            </>
                          )
                        ) : null}
                      </>
                    )}
                  </div>
                </div>

                {confirming ? (
                  <p className="mt-2 text-[0.68rem] text-amber-300/75">
                    This also deletes {p.name}'s history, wishlist and taste. Press Delete? to confirm.
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>

        <div className="mt-4 flex justify-end">
          <button type="button" data-nav onClick={onClose} className="btn-soft">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
