import { defineComponent, h } from 'vue'

import AuthLayout from '@/layouts/AuthLayout.vue'
import { mountWithPlugins } from '@/test/mount'

describe('AuthLayout', () => {
  it('frames the page with the brand panel and a theme toggle', async () => {
    const { wrapper } = await mountWithPlugins(AuthLayout, {
      slots: { default: () => h('p', { class: 'page' }, 'Sign in') },
    })
    expect(wrapper.find('aside').text()).toContain('Every account, budget and bill. Only yours.')
    expect(wrapper.findAll('.auth-layout__promises li')).toHaveLength(3)
    expect(wrapper.find('.page').text()).toBe('Sign in')
    expect(wrapper.find('.auth-layout__content').attributes('style')).toContain('max-width: 504px')
    expect(wrapper.findComponent({ name: 'ThemeToggle' }).exists()).toBe(true)
  })

  it('takes its own panel and width', async () => {
    const Host = defineComponent({
      render: () =>
        h(AuthLayout, { width: 560 }, { aside: () => h('p', { class: 'custom' }, 'Welcome') }),
    })
    const { wrapper } = await mountWithPlugins(Host)
    expect(wrapper.find('aside .custom').text()).toBe('Welcome')
    expect(wrapper.find('.auth-layout__promises').exists()).toBe(false)
    expect(wrapper.find('.auth-layout__content').attributes('style')).toContain('max-width: 624px')
  })
})
