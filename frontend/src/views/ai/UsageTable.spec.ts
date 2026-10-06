import { makeUsage } from '@/test/ai'
import { mountWithPlugins } from '@/test/mount'
import UsageTable from '@/views/ai/UsageTable.vue'

async function render(width: number) {
  const { wrapper } = await mountWithPlugins(UsageTable, {
    width,
    props: {
      caption: 'What each model was used for and what it cost',
      heading: 'Model',
      rows: makeUsage().models,
    },
  })
  return wrapper
}

describe('UsageTable', () => {
  it('shows every number of each row on a computer', async () => {
    const wrapper = await render(1280)

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      'Model',
      'Calls',
      'Tokens in',
      'Tokens out',
      'Cost',
    ])
    const [first, second] = wrapper.findAll('[data-test="usage-row"]')
    expect(first!.findAll('th, td').map((cell) => cell.text())).toEqual([
      'GPT-6 Luna (OpenAI)',
      '6',
      '40K',
      '3K',
      '$0.0055',
    ])
    expect(second!.findAll('td')[3]!.text()).toBe('$0.0003')
    expect(wrapper.find('[data-test="usage-more"]').exists()).toBe(false)
    expect(wrapper.find('caption').text()).toBe('What each model was used for and what it cost')
  })

  it('puts the numbers under the name on a phone, which has no room for columns', async () => {
    const wrapper = await render(400)

    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual(['Model', 'Cost'])
    const [first] = wrapper.findAll('[data-test="usage-row"]')
    expect(first!.find('[data-test="usage-more"]').text()).toBe('6 calls · 40K in · 3K out')
    expect(first!.findAll('td')).toHaveLength(1)
    expect(first!.find('td').text()).toBe('$0.0055')
  })
})
