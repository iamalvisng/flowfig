import type { Figure } from '../src';

// An example roadmap: Q4 billing work on three tracks, linked to the plan document.

const doc = 'docs/roadmap-example.md';

const props: Figure['props'] = {
  timeline: true,
  today: '2026-10-19',
  layout: {
    direction: 'column',
    children: [
      {
        id: 'product',
        label: 'Product',
        children: [
          { id: 'invoice', label: 'Invoice redesign', from: '2026-10-05', to: '2026-10-23', source: `${doc}#invoice-redesign` },
          { id: 'plan', label: 'Self-serve plan change', from: '2026-11-16', to: '2026-12-11', source: `${doc}#self-serve-plan-change` },
          { id: 'usage', label: 'Usage-based pricing', from: '2026-10-26', to: '2026-11-27', source: `${doc}#usage-based-pricing` },
        ],
      },
      {
        id: 'platform',
        label: 'Platform',
        children: [
          { id: 'metering', label: 'Metering pipeline', from: '2026-10-05', to: '2026-10-30', source: `${doc}#metering-pipeline` },
          { id: 'ledger', label: 'Ledger migration', from: '2026-11-02', to: '2026-12-04', source: `${doc}#ledger-migration` },
        ],
      },
      {
        id: 'launch',
        label: 'Launch',
        children: [
          { id: 'beta', label: 'Beta', tone: 'purple', from: '2026-11-30', source: `${doc}#beta-with-20-customers` },
          { id: 'page', label: 'Price page', from: '2026-12-07', to: '2026-12-11', source: `${doc}#pricing-page-update` },
          { id: 'ga', label: 'GA', tone: 'purple', from: '2026-12-15', source: `${doc}#general-availability` },
        ],
      },
    ],
  },
  edges: [
    { id: 'm-usage', from: 'metering', to: 'usage' },
    { id: 'm-ledger', from: 'metering', to: 'ledger' },
    { id: 'usage-page', from: 'usage', to: 'page' },
  ],
};

export default {
  title: 'Q4 roadmap',
  props,
} satisfies Figure;
