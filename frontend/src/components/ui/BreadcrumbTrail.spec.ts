import { mountWithPlugins } from '@/test/mount'
import BreadcrumbTrail from '@/components/ui/BreadcrumbTrail.vue'

const trail = [{ title: 'Bills', to: '/bills' }]

async function render(
  width: number,
  props: Partial<InstanceType<typeof BreadcrumbTrail>['$props']> = {},
) {
  const { wrapper } = await mountWithPlugins(BreadcrumbTrail, {
    width,
    props: { trail, current: 'City Power', ...props },
  })
  return wrapper
}

describe('BreadcrumbTrail', () => {
  it('shows where a page is: the pages above it as links, then this one', async () => {
    const wrapper = await render(1280)

    expect(wrapper.find('nav').attributes('aria-label')).toBe('Breadcrumb')
    const items = wrapper.findAll('.v-breadcrumbs-item')
    expect(items.map((item) => item.text())).toEqual(['Bills', 'City Power'])
    expect(items[0]!.find('a').attributes('href')).toBe('/bills')
    // This page is named as the one being read, and isn't a link.
    expect(items[1]!.attributes('aria-current')).toBe('page')
    expect(items[1]!.find('a').exists()).toBe(false)
    expect(wrapper.find('[data-test="breadcrumb-back"]').exists()).toBe(false)
  })

  it('shows every page above it, the broadest first', async () => {
    const wrapper = await render(1280, {
      trail: [
        { title: 'Accounts', to: '/accounts' },
        { title: 'Everyday checking', to: '/accounts/1' },
      ],
      current: 'Settings',
    })

    expect(wrapper.findAll('.v-breadcrumbs-item').map((item) => item.text())).toEqual([
      'Accounts',
      'Everyday checking',
      'Settings',
    ])
  })

  it('offers a phone the way back to the page just above, which a screen reader hears in full', async () => {
    const wrapper = await render(400, {
      trail: [
        { title: 'Accounts', to: '/accounts' },
        { title: 'Everyday checking', to: '/accounts/1' },
      ],
    })

    const back = wrapper.find('[data-test="breadcrumb-back"]')
    expect(back.text()).toBe('Everyday checking')
    expect(back.attributes('aria-label')).toBe('Back to Everyday checking')
    expect(back.attributes('href')).toBe('/accounts/1')
    expect(wrapper.find('.v-breadcrumbs').exists()).toBe(false)
    // Still a labelled landmark, so it can be found.
    expect(wrapper.find('nav').attributes('aria-label')).toBe('Breadcrumb')
  })
})
