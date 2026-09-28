# 银卡捡漏台

EA FC 27 Ultimate Team 小工具。在 FUT Gallery 里按 S 级门槛从低到高找球队，把这些球队最便宜阵容里用到的银卡（65–74）按价格排好，并算出扣掉 5% 交易税后的倒卖利润。

## 两个部分

| 文件 | 作用 |
| --- | --- |
| `index.html` | 网页版，内置 2026-09-28 的快照数据，打开就能看 |
| `fut-silver-flip.user.js` | 浏览器脚本，装好后在 fut.gg 上看实时价格 |

## 安装实时脚本

1. 在 Chrome / Edge 装 [Tampermonkey](https://www.tampermonkey.net/)。Chrome 需要在扩展详情里打开「允许用户脚本」。
2. 点开仓库里的 [`fut-silver-flip.user.js`](fut-silver-flip.user.js)，再点右上角 **Raw**，Tampermonkey 会弹出安装页，点「安装」。
3. 打开 <https://www.fut.gg/fut-gallery/>，点右下角「银卡捡漏」。

## 数据说明

- 球队、阵容和价格来自 [fut.gg](https://www.fut.gg/)，本项目和 fut.gg、EA 没有关系。
- 价格是 fut.gg 发布的最新价，几分钟更新一次，买之前请在游戏里再确认。
- 利润按 EA 5% 交易税和 FUT 价格档位（1,000 以下每档 50，1,000–10,000 每档 100，10,000–50,000 每档 250）计算。
1