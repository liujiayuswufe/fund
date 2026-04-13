# github_fof

这是一个可直接上传到 GitHub Pages 的静态 FOF 页面。

## 入口

- `index.html`

## 数据来源

- 基金净值：Supabase `fund_net_value`
- 基准数据：Supabase `benchmark_price`

页面只使用 Supabase publishable key，不依赖本地 `fof_server.py`。

## 本地保存

- 已保存 FOF 组合存放在浏览器 `localStorage`
- 不会写回 Supabase
- 更换浏览器或清空浏览器缓存后，需要重新保存组合

## 部署

把 `github_fof` 目录内文件作为 GitHub Pages 的站点内容即可。
