import '../src/element.ts';
import type { FlowfigExplain } from '../src/element.ts';
import oil from '../figures/explain-oil.ts';
import returns from '../figures/returns-process.ts';
import checkout from '../figures/checkout.ts';
import sync from '../figures/explain-sync.ts';
import deliveryBefore from '../figures/explain-delivery-before.ts';
import deliveryAfter from '../figures/explain-delivery-after.ts';

const el = (id: string) => document.getElementById(id) as FlowfigExplain;
el('oil').spec = oil.props;
el('returns').spec = returns.props;
el('checkout').spec = checkout.props;
el('sync').spec = sync.props;
el('delivery').beforeSpec = deliveryBefore.props;
el('delivery').spec = deliveryAfter.props;
