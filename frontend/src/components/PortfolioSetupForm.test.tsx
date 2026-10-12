import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioSetupForm } from './PortfolioSetupForm';

vi.mock('../lib/use-portfolio-quotes', () => ({
 usePortfolioQuotes: () => ({quotes:{'510300.SH':{symbol:'510300.SH',price:1.237,change_percent:.05,trade_time:'2026-10-09T10:00:00+08:00'}},loading:false,error:'',refresh:()=>{}}),
 loadPortfolioQuotes:vi.fn(),
}));

describe('ETF portfolio editing',()=>{
 it('keeps three-decimal quotes, fund units and raw valuation arithmetic',()=>{
  const html=renderToStaticMarkup(<PortfolioSetupForm draft={{profile:'balanced',totalAssets:10000,holdings:[{symbol:'510300.SH',name:'样本ETF',instrumentType:'etf',weight:50,costPrice:'1.236'}]}} directory={[]} actionLabel="分析" busyLabel="分析中" onChange={()=>{}} onSubmit={()=>{}} />);
  expect(html).toContain('1.237 元');expect(html).toContain('份');expect(html).not.toContain('1.24 元');expect(html).toContain('+0.05%');
 });
});

describe('PortfolioSetupForm', () => {
	it('keeps every holding slider on a stable 1-100 scale', () => {
		const markup = renderToStaticMarkup(<PortfolioSetupForm
			draft={{
				profile: 'balanced',
				holdings: [
					{ symbol: '688002.SH', name: '睿创微纳', weight: 31, costPrice: '' },
					{ symbol: '300209.SZ', name: '有棵树', weight: 20, costPrice: '' },
				],
			}}
			directory={[]}
			actionLabel="开始 AI 巡检"
			busyLabel="巡检进行中"
			onChange={() => {}}
			onSubmit={() => {}}
		/>);

		const sliders = markup.match(/<input[^>]+type="range"[^>]*>/g) || [];
		expect(sliders).toHaveLength(2);
		expect(sliders.every((slider) => slider.includes('min="1"') && slider.includes('max="100"'))).toBe(true);
	});
});
