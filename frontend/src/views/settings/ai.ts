import type { AiModel } from '@/api/ai'
import { priceLine } from '@/utils/ai'

/** What's wrong with an Ollama address, in words for people, or null when it looks right. */
export function problemWithAddress(address: string): string | null {
  const text = address.trim()
  if (!text) return 'Enter the address of your Ollama server.'
  return /^https?:\/\/\S+$/i.test(text)
    ? null
    : 'Start it with http:// or https://, like http://host.docker.internal:11434.'
}

/** A model in the list to choose from. */
export interface ModelItem {
  title: string
  value: string
  model: AiModel | null
}

/**
 * The models to choose from: the list the provider has, or for Ollama the ones fetched, or none
 * until a provider is chosen. The model already chosen stays on the list, so it isn't dropped
 * before the list has been fetched.
 */
export function modelItems(
  listed: readonly AiModel[] | undefined,
  fetched: readonly AiModel[] | null,
  chosen: string,
): ModelItem[] {
  const items: ModelItem[] = (listed?.length ? listed : (fetched ?? [])).map((model) => ({
    title: model.name,
    value: model.id,
    model,
  }))
  if (chosen && !items.some((item) => item.value === chosen)) {
    items.unshift({ title: chosen, value: chosen, model: null })
  }
  return items
}

/** What to say under a model: what it's good for, and what it costs. */
export function modelDetail(model: AiModel | null, locale = 'en-US'): string {
  if (!model) return ''
  return [model.note, priceLine(model, locale)].filter(Boolean).join(' · ')
}
