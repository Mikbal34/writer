/**
 * Shared controls used by every per-format academic-meta form.
 *
 * The form components render their own fields and layout; these are the
 * small presentational/editor primitives they reuse. Every control is
 * fully-controlled — no internal state beyond transient focus/edit
 * buffers.
 */

"use client"

import { useState } from "react"
import { Loader2, Plus, Sparkles, Trash2, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

// =================================================================
//  Auto-fill icon button — used next to fields that have a derivable
//  default (word counts from content, today's date, subtitle from
//  title, etc.). Keeps the button-row visually distinct from the
//  Sparkles AI button.
// =================================================================

export function AutoFillButton({
  onClick,
  loading,
  hint,
}: {
  onClick: () => void
  loading?: boolean
  hint?: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={loading}
      title={hint ?? "Auto-fill"}
      className="h-6 px-2 text-[10px] gap-1 text-[#5C4A32] hover:bg-[#F0E8D8]"
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Wand2 className="h-3 w-3" />
      )}
      Auto-fill
    </Button>
  )
}

// =================================================================
//  FormSection — labelled group wrapper
// =================================================================

export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-ui text-xs uppercase tracking-widest text-[#5C4A32]">
          {title}
        </h2>
        {description ? (
          <p className="font-body text-[11px] text-[#8a7a65] mt-1 leading-snug">
            {description}
          </p>
        ) : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

// =================================================================
//  TextField — labelled <Input>
// =================================================================

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  maxLength,
  hint,
  type = "text",
  onAutoFill,
  autoFillLoading,
  autoFillHint,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  placeholder?: string
  required?: boolean
  maxLength?: number
  hint?: string
  type?: "text" | "number" | "email"
  onAutoFill?: () => void
  autoFillLoading?: boolean
  autoFillHint?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">
          {label}
          {required ? <span className="text-red-600 ml-0.5">*</span> : null}
        </Label>
        {onAutoFill ? (
          <AutoFillButton
            onClick={onAutoFill}
            loading={autoFillLoading}
            hint={autoFillHint}
          />
        ) : null}
      </div>
      <Input
        type={type}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value
          onChange(v.length === 0 ? null : v)
        }}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      {hint ? (
        <p className="text-[10px] text-[#8a7a65]">{hint}</p>
      ) : null}
    </div>
  )
}

// =================================================================
//  NumberField — labelled numeric <Input>
// =================================================================

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  min = 0,
  onAutoFill,
  autoFillLoading,
  autoFillHint,
}: {
  label: string
  value: number | null
  onChange: (next: number | null) => void
  placeholder?: string
  hint?: string
  min?: number
  onAutoFill?: () => void
  autoFillLoading?: boolean
  autoFillHint?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {onAutoFill ? (
          <AutoFillButton
            onClick={onAutoFill}
            loading={autoFillLoading}
            hint={autoFillHint}
          />
        ) : null}
      </div>
      <Input
        type="number"
        min={min}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === "") return onChange(null)
          const n = Number(raw)
          onChange(Number.isFinite(n) && n >= min ? n : null)
        }}
        placeholder={placeholder}
      />
      {hint ? (
        <p className="text-[10px] text-[#8a7a65]">{hint}</p>
      ) : null}
    </div>
  )
}

// =================================================================
//  TextAreaField — labelled <Textarea> with optional AI button
// =================================================================

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 5,
  hint,
  onGenerate,
  generating,
  onAutoFill,
  autoFillLoading,
  autoFillHint,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  placeholder?: string
  rows?: number
  hint?: string
  onGenerate?: () => void
  generating?: boolean
  onAutoFill?: () => void
  autoFillLoading?: boolean
  autoFillHint?: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1">
          {onAutoFill ? (
            <AutoFillButton
              onClick={onAutoFill}
              loading={autoFillLoading}
              hint={autoFillHint}
            />
          ) : null}
          {onGenerate ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onGenerate}
              disabled={generating}
              className="h-6 px-2 text-[10px] gap-1 text-[#5C4A32] hover:bg-[#F0E8D8]"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {generating ? "Generating…" : "Generate with AI"}
            </Button>
          ) : null}
        </div>
      </div>
      <Textarea
        rows={rows}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value
          onChange(v.length === 0 ? null : v)
        }}
        placeholder={placeholder}
      />
      {hint ? (
        <p className="text-[10px] text-[#8a7a65]">{hint}</p>
      ) : null}
    </div>
  )
}

// =================================================================
//  StringListField — comma-separated editor for keywords/committee etc.
// =================================================================

/**
 * Simple comma-separated editor: we keep a local buffer so the user can
 * type commas freely, and commit to the parent as a trimmed array on
 * blur. This avoids flicker from parsing on every keystroke.
 */
export function StringListField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  onGenerate,
  generating,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  hint?: string
  onGenerate?: () => void
  generating?: boolean
}) {
  const [buffer, setBuffer] = useState<string>(() => value.join(", "))
  const [focused, setFocused] = useState(false)

  // Keep the buffer in sync when parent value changes from outside
  // (e.g., AI fill) but only while we are NOT actively editing.
  if (!focused) {
    const joined = value.join(", ")
    if (joined !== buffer) {
      // Update asynchronously on the next tick to avoid setState-in-render.
      queueMicrotask(() => setBuffer(joined))
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {onGenerate ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onGenerate}
            disabled={generating}
            className="h-6 px-2 text-[10px] gap-1 text-[#5C4A32] hover:bg-[#F0E8D8]"
          >
            {generating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            {generating ? "Generating…" : "Generate with AI"}
          </Button>
        ) : null}
      </div>
      <Input
        value={buffer}
        onChange={(e) => setBuffer(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          const next = buffer
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
          onChange(next)
        }}
        placeholder={placeholder}
      />
      {hint ? (
        <p className="text-[10px] text-[#8a7a65]">{hint}</p>
      ) : null}
    </div>
  )
}

// =================================================================
//  RepeatableList — add/remove sub-editors (authors, committee)
// =================================================================

export function RepeatableList<T>({
  title,
  items,
  onChange,
  renderItem,
  emptyItem,
  addLabel,
  itemLabel,
  minItems = 0,
}: {
  title: string
  items: T[]
  onChange: (next: T[]) => void
  renderItem: (item: T, index: number, update: (patch: Partial<T>) => void) => React.ReactNode
  emptyItem: () => T
  addLabel: string
  itemLabel: (index: number) => string
  minItems?: number
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-ui text-[11px] uppercase tracking-widest text-[#5C4A32]">
          {title}
        </h3>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...items, emptyItem()])}
          className="h-7 gap-1 text-[11px]"
        >
          <Plus className="h-3 w-3" />
          {addLabel}
        </Button>
      </div>
      <div className="space-y-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-sm border border-[#d4c9b5] bg-white p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-ui text-[11px] text-[#8a7a65]">
                {itemLabel(i)}
              </span>
              {items.length > minItems ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  className="h-6 px-2 text-[10px] gap-1 text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Remove
                </Button>
              ) : null}
            </div>
            {renderItem(item, i, (patch) =>
              onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// =================================================================
//  BooleanToggle — checkbox with long label
// =================================================================

export function BooleanToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-[#d4c9b5] bg-white px-3 py-2.5 cursor-pointer hover:bg-[#FAF7F0] transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span className="flex-1">
        <span className="block font-ui text-xs font-medium text-[#2D1F0E]">
          {label}
        </span>
        {description ? (
          <span className="block font-body text-[11px] text-[#8a7a65] leading-snug mt-0.5">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

// =================================================================
//  VariantPicker — tab-style chooser for sub-variants (APA, Chicago)
// =================================================================

export function VariantPicker<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string; description?: string }>
  onChange: (next: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`text-left rounded-md border px-3 py-2 transition-colors ${
                active
                  ? "border-[#2C5F2E] bg-[#F0E8D8]"
                  : "border-[#d4c9b5] bg-white hover:border-[#8a7a65]"
              }`}
            >
              <div className="font-ui text-xs font-medium text-[#2D1F0E]">
                {opt.label}
              </div>
              {opt.description ? (
                <div className="font-body text-[10px] text-[#8a7a65] mt-0.5">
                  {opt.description}
                </div>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
