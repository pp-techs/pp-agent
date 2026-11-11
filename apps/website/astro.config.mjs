// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

const site = 'https://ppagent.monback.app';
const repository = 'https://github.com/pp-techs/pp-agent';

export default defineConfig({
  site,
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'PP Agent',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        vi: { label: 'Tiếng Việt', lang: 'vi' },
      },
      description:
        'A desktop AI agent for business teams. Chat with documents, use business systems through MCP, and switch between purpose-built agents, with an approval before anything changes.',
      logo: {
        light: './src/assets/logo-horizontal.svg',
        dark: './src/assets/logo-horizontal-on-dark.svg',
        alt: 'PP Agent',
        replacesTitle: true,
      },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      editLink: {
        baseUrl: `${repository}/edit/main/apps/website/`,
      },
      lastUpdated: true,
      expressiveCode: {
        themes: ['github-light', 'github-dark'],
      },
      customCss: ['./src/styles/starlight.css'],
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/site.webmanifest' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0f1b26', media: '(prefers-color-scheme: dark)' } },
        { tag: 'meta', attrs: { property: 'og:image', content: `${site}/og.png` } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: 'PP Agent, a desktop AI agent for business teams' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${site}/og.png` } },
      ],
      sidebar: [
        {
          label: 'Start here',
          translations: { vi: 'Bắt đầu' },
          items: [
            { label: 'Overview', translations: { vi: 'Tổng quan' }, slug: 'docs' },
            { slug: 'docs/install' },
            { slug: 'docs/first-run' },
          ],
        },
        {
          label: 'Everyday work',
          translations: { vi: 'Công việc hằng ngày' },
          items: [
            { slug: 'docs/chat-and-documents' },
            { slug: 'docs/research-and-long-tasks' },
            { slug: 'docs/history-and-memory' },
          ],
        },
        {
          label: 'Set up',
          translations: { vi: 'Thiết lập' },
          items: [
            { slug: 'docs/models' },
            { slug: 'docs/agents-and-skills' },
            { slug: 'docs/company-software' },
            { slug: 'docs/tools-and-approvals' },
            { slug: 'docs/scheduled-tasks' },
          ],
        },
        {
          label: 'Use it anywhere',
          translations: { vi: 'Dùng ở mọi nơi' },
          items: [
            { slug: 'docs/side-panel-and-browser' },
            { slug: 'docs/remote-access-and-channels' },
            { slug: 'docs/voice-and-notifications' },
          ],
        },
        {
          label: 'Safety',
          translations: { vi: 'An toàn' },
          items: [
            { slug: 'docs/security-and-privacy' },
            { slug: 'docs/data-storage' },
          ],
        },
        {
          label: 'More',
          translations: { vi: 'Thêm' },
          items: [
            { slug: 'docs/faq' },
            { slug: 'docs/architecture' },
            {
              label: 'What’s new',
              translations: { vi: 'Có gì mới' },
              link: `${repository}/blob/main/CHANGELOG.md`,
            },
            { label: 'GitHub', link: repository, attrs: { target: '_blank' } },
          ],
        },
      ],
    }),
    sitemap(),
  ],
});
