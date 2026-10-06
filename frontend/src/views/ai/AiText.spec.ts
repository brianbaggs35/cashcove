import { mountWithPlugins } from '@/test/mount'
import AiText from '@/views/ai/AiText.vue'

async function render(text: string) {
  const { wrapper } = await mountWithPlugins(AiText, { props: { text } })
  return wrapper
}

describe('AiText', () => {
  it('shows paragraphs, lists, bold and code', async () => {
    const wrapper = await render(
      'You spent **$420.00** on `Groceries`.\n\nTop three:\n- Groceries\n- Coffee\n\n1. First\n2. Second',
    )

    const paragraphs = wrapper.findAll('p')
    expect(paragraphs.map((paragraph) => paragraph.text())).toEqual([
      'You spent $420.00 on Groceries.',
      'Top three:',
    ])
    expect(wrapper.find('strong').text()).toBe('$420.00')
    expect(wrapper.find('code').text()).toBe('Groceries')
    expect(wrapper.findAll('ul > li').map((item) => item.text())).toEqual(['Groceries', 'Coffee'])
    expect(wrapper.findAll('ol > li').map((item) => item.text())).toEqual(['First', 'Second'])
  })

  it('shows anything an answer contains as text, never as part of the page', async () => {
    const wrapper = await render(
      '<img src=x onerror="alert(1)"> and <script>alert(2)</script>\n- <b>item</b>',
    )

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror="alert(1)">')
    expect(wrapper.text()).toContain('<b>item</b>')
  })

  it('shows nothing for nothing', async () => {
    const wrapper = await render('')

    expect(wrapper.find('[data-test="ai-text"]').text()).toBe('')
  })
})
