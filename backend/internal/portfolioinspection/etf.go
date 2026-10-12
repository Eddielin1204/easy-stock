package portfolioinspection

import (
	"math"
	"time"

	"easy-stock/backend/internal/etfanalysis"
	"easy-stock/backend/internal/stockanalysis"
)

func isETF(a *stockanalysis.Analysis) bool {
	return a != nil && a.InstrumentType == "etf" && a.ETF != nil
}
func analysisChart(a *stockanalysis.Analysis) []stockanalysis.TrendPoint {
	if a == nil {
		return nil
	}
	if !isETF(a) {
		return a.Chart
	}
	if a.ETF.Profile.AssetClass == "money" {
		return nil
	}
	points := []stockanalysis.TrendPoint{}
	bars := a.ETF.TrendBars
	if len(bars) == 0 {
		bars = a.ETF.Bars
	}
	for _, b := range etfanalysis.ContinuousHistory(bars) {
		points = append(points, stockanalysis.TrendPoint{Date: b.Time.In(time.FixedZone("CST", 8*3600)).Format("2006-01-02"), Close: b.Close})
	}
	return points
}
func etfVolatility(a *stockanalysis.Analysis) float64 {
	points := analysisChart(a)
	if len(points) < 21 {
		return 0
	}
	points = points[max(0, len(points)-61):]
	values := []float64{}
	for i := 1; i < len(points); i++ {
		if points[i-1].Close > 0 && points[i].Close > 0 {
			values = append(values, (points[i].Close/points[i-1].Close-1)*100)
		}
	}
	if len(values) < 20 {
		return 0
	}
	mean := average(values)
	variance := 0.
	for _, v := range values {
		variance += (v - mean) * (v - mean)
	}
	return math.Sqrt(variance / float64(len(values)-1))
}

// Disclosed positions are lower-bound exposure, not a complete look-through.
// Identifiers must include a known market to avoid merging HK/US/domestic codes.
func etfPortfolioFacts(results []HoldingResult, metrics Metrics) map[string]Fact {
	facts := map[string]Fact{}
	exposure := map[string]float64{}
	contributors := map[string]int{}
	for _, r := range results {
		if r.Status != "succeeded" || r.Analysis == nil {
			continue
		}
		a := r.Analysis
		prefix := r.Holding.Symbol + "."
		kind := "stock"
		if isETF(a) {
			kind = "etf"
		}
		facts[prefix+"instrument_type"] = Fact{Value: kind, Available: true, Method: "报告确认的标的类型"}
		if !isETF(a) {
			exposure[r.Holding.Symbol] += EquityPercent(r.Holding.Weight, metrics.TotalPositionPercent)
			contributors[r.Holding.Symbol]++
			continue
		}
		etf := a.ETF
		asOf := r.ResearchCutoffAt
		facts[prefix+"etf.asset_class"] = Fact{Value: etf.Profile.AssetClass, Available: etf.Profile.AssetClass != "" && etf.Profile.AssetClass != "unknown", AsOf: asOf, Method: "基金档案资产类别"}
		facts[prefix+"etf.cross_border"] = Fact{Value: etf.Profile.CrossBorder, Available: true, AsOf: asOf, Method: "基金档案跨境属性"}
		facts[prefix+"etf.tracking_target"] = Fact{Value: etf.Profile.TrackingTarget, Available: etf.Profile.TrackingTarget != "", AsOf: asOf, Method: "基金档案跟踪标的；同指数不同基金不代表分散底层风险"}
		facts[prefix+"etf.execution_blockers"] = Fact{Value: etf.ExecutionBlockers, Available: true, AsOf: asOf, Method: "原研究执行限制；刷新价格不会更新执行许可"}
		facts[prefix+"etf.holdings"] = Fact{Value: etf.Holdings, Available: len(etf.Holdings) > 0, AsOf: asOf, Method: "按原报告期披露的部分持仓", Limitation: "不等于当前实际持仓；不同报告期不可视作同时持有；未披露不等于零"}
		seen := map[string]bool{}
		for _, h := range etf.Holdings {
			for _, v := range h.Items {
				if v.Symbol == "" || seen[v.Symbol] {
					continue
				}
				seen[v.Symbol] = true
				exposure[v.Symbol] += EquityPercent(r.Holding.Weight, metrics.TotalPositionPercent) * v.WeightPercent / 100
				contributors[v.Symbol]++
			}
		}
	}
	for symbol, weight := range exposure {
		if contributors[symbol] < 2 {
			continue
		}
		facts["disclosed_overlap."+symbol] = Fact{Value: round(weight, 4), Available: true, Method: "直接持仓与ETF披露持仓穿透后占全部持仓的已知比例%", Limitation: "不同报告期的部分持仓静态估算，不是实时完整暴露；未披露部分未知"}
	}
	return facts
}

const ETFPortfolioPolicy = `
ETF使用instrument_type和etf事实识别；股票、ETF均为组合持仓，equity_*历史字段现表示全部证券持仓归一化，现金单列，货币ETF仍是基金不是现金。ETF不套用公司ROE、营收、扣非利润或个股总分。股票型看底层指数/行业，债券看久期信用，商品看现货/期货，货币看收益分配与流动性；没有证据明确未知。ETF逻辑维度评价底层依据与产品适配，风险维度评价价差/估值/跟踪/退出限制；不以未知数据当作零风险。相同指数ETF要合并看共同驱动，disclosed_overlap仅为不同报告期部分持仓的静态重叠，不能宣称完整实时风险分散。跨境关注汇率和时差。原ETF execution_blockers不得由组合研究绕过。
`

func ETFPolicyFor(results []HoldingResult) string {
	for _, r := range results {
		if isETF(r.Analysis) {
			return ETFPortfolioPolicy
		}
	}
	return ""
}
