import { makeModel } from '@/test/ai'
import { modelDetail, modelItems, problemWithAddress } from '@/views/settings/ai'

describe('problemWithAddress', () => {
  it.each(['http://host.docker.internal:11434', 'https://ollama.lan', ' HTTP://Host:11434 '])(
    'has nothing to say about %s',
    (address) => {
      expect(problemWithAddress(address)).toBeNull()
    },
  )

  it('asks for an address', () => {
    expect(problemWithAddress('')).toBe('Enter the address of your Ollama server.')
    expect(problemWithAddress('   ')).toBe('Enter the address of your Ollama server.')
  })

  it.each(['localhost:11434', 'ftp://host', 'http://', 'http://has space'])(
    'says how %s should start',
    (address) => {
      expect(problemWithAddress(address)).toContain('Start it with http:// or https://')
    },
  )
})

describe('modelItems', () => {
  const luna = makeModel()
  const nano = makeModel({ id: 'gpt-5.4-nano', name: 'GPT-5.4 nano' })

  it('lists a provider’s own models', () => {
    expect(modelItems([luna, nano], null, 'gpt-6-luna')).toEqual([
      { title: 'GPT-6 Luna', value: 'gpt-6-luna', model: luna },
      { title: 'GPT-5.4 nano', value: 'gpt-5.4-nano', model: nano },
    ])
  })

  it('lists the models fetched from Ollama, and none before they are', () => {
    const fetched = [makeModel({ id: 'llama3.2:3b', name: 'llama3.2:3b' })]

    expect(modelItems([], fetched, 'llama3.2:3b').map((item) => item.value)).toEqual([
      'llama3.2:3b',
    ])
    expect(modelItems([], null, '')).toEqual([])
  })

  it('has none until a provider is chosen', () => {
    expect(modelItems(undefined, null, '')).toEqual([])
  })

  it('keeps the model already chosen on the list until the list is fetched, or when it is gone', () => {
    expect(modelItems([], null, 'qwen3:8b')).toEqual([
      { title: 'qwen3:8b', value: 'qwen3:8b', model: null },
    ])
    expect(modelItems([luna], null, 'retired-model').map((item) => item.value)).toEqual([
      'retired-model',
      'gpt-6-luna',
    ])
  })
})

describe('modelDetail', () => {
  it('says what a model is for and what it costs', () => {
    expect(modelDetail(makeModel())).toBe(
      'The most efficient GPT-6, for focused, high-volume work. · $0.10 in · $0.50 out per million tokens',
    )
  })

  it('leaves out what it doesn’t have', () => {
    expect(modelDetail(makeModel({ note: null }))).toBe('$0.10 in · $0.50 out per million tokens')
    expect(modelDetail(makeModel({ input_price: null, output_price: null, note: 'Fast.' }))).toBe(
      'Fast.',
    )
    expect(modelDetail(makeModel({ input_price: null, output_price: null, note: null }))).toBe('')
    expect(modelDetail(null)).toBe('')
  })
})
