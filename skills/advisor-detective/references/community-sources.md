# 社区导师评价知识库

## 目录

- [用途与边界](#用途与边界)
- [本地快照](#本地快照)
- [外部来源](#外部来源)
- [调查时如何使用](#调查时如何使用)
- [证据与隐私规则](#证据与隐私规则)

## 用途与边界

将社区维护的导师评价资料作为 `advisor-detective` 的调查线索库。资料可能包含匿名、过时、互相矛盾或未经证实的内容，不代表事实结论，也不得替代学校公告、论文原文、导师主页、已核验学生经历等更强证据。

仅在调查具体导师时按姓名、学校和实验室检索相关段落。不要在没有目标导师的情况下把完整榜单加载进上下文。

## 本地快照

运行：

```bash
python3 scripts/sync_community_knowledge.py
```

脚本在本目录生成以下本地文件：

| 文件 | 内容 |
| --- | --- |
| `community-blacklist-current.pdf` | Google Drive 中的黑榜 PDF 原始快照 |
| `community-blacklist-current.txt` | PDF 的可检索文本；本机有 `pdftotext` 时生成 |
| `community-red-flags-current.txt` | Google Doc 红榜的纯文本导出 |
| `community-knowledge-metadata.json` | 抓取时间、哈希、大小与变化状态 |
| `community-links.json` | 从快照中提取的外链 |

这些快照默认被 `.gitignore` 排除，只保存在本地，不进入公开 Git 历史。

## 外部来源

以下链接于 2026-07-28 做过一次可访问性检查。每次正式调查仍需重新打开并记录查询日期。

| 来源 | 用途 | 检查结果 | 证据定位 |
| --- | --- | --- | --- |
| [黑榜 PDF](https://drive.google.com/file/d/1DMpkLQMIvk7-bO8lux1cU1YNth6s0J3h/view) | 用户提供的静态黑榜快照 | 可下载 | 匿名社区线索，默认 D |
| [Advisor Red Flags Notes](https://docs.google.com/document/d/1-AtKUh-xE1CPRRDVlfPx1d42Trhr7F8qQIw69hP85Ds/edit) | 用户提供的持续编辑红榜 | 可导出 | 匿名社区线索，默认 D |
| [the-hidden-fish/advisor-ledger](https://github.com/the-hidden-fish/advisor-ledger/) | Google Doc 的版本化镜像、差异与历史快照 | 可访问 | 用于追溯说法何时出现或被修改，不证明说法真实 |
| [Advisor Ledger 网页视图](https://the-hidden-fish.github.io/advisor-ledger/) | 浏览快照、历史修改和删除内容 | 可访问；页面快照可能落后于源文档 | 同上 |
| [BAIR volunteer faithful view](https://bair-volunteer.github.io/advisor-ledger/faithful/) | 另一网页化镜像 | 可访问；独立性不明 | 不作为额外交叉来源 |
| [Append Advisor Reviews](https://append.page/p/advisors) | 匿名评论平台 | 可访问 | 单条评论默认 D |
| [Rank My Advisor](https://advisoreval2026-star.github.io/rankmyadvisor/) | 可视化评论面板 | 检查时无法稳定加载 | 仅在重新访问成功后使用 |
| [AdvisorEval2026](https://advisoreval2026-star.github.io/AdvisorEval2026/) | 地图/评论可视化 | 检查时无法稳定加载 | 仅在重新访问成功后使用 |

正文中的 Reddit、知乎、一亩三分地、Rate My Professors、OpenReview 等链接必须逐条判断身份对应关系和访问状态。平台受限或身份无法确认时，记录“未完成核验”，不要改写成事实。

2026-07-28 补充检查：

- GitHub 指定快照目录、Advisor Ledger 网页、BAIR faithful 镜像、Append、Reddit 和 Rate My Professors 可访问。
- 两个 AdvisorEval 可视化页面在自动检查中无法稳定加载。
- OpenReview 链接进入浏览器验证页；知乎问答返回 403；一亩三分地页面出现解码错误；小红书短链被自动访问环境拦截。将这些链接标为“平台受限，未完成核验”。
- PDF 文本提取可能在换行处截断长 URL。末尾明显不完整的链接不得直接判为失效；应回到 PDF 对应页恢复完整链接。

## 调查时如何使用

1. 先读取 `community-knowledge-metadata.json`；缺失或超过 24 小时未刷新时运行同步脚本。
2. 用导师英文全名、中文名、学校和实验室名分别检索两个文本快照，例如：

   ```bash
   rg -n -i -C 4 'Full Name|中文名|Lab Name' references/community-*-current.txt
   ```

3. 保留命中段落中的反驳、争议标签和上下文，不只摘取负面句子。
4. 打开命中段落提供的原始外链，并用官方来源、论文记录或身份可确认的一手经历交叉核验。
5. 在 Sheet 4/6 中记录原始链接、查询日期、匿名性、证据等级和核验结果。
6. 只有满足 `advisor-detective` 的多源规则后，相关信号才可影响评分；否则只列为“待核实线索”。

## 证据与隐私规则

- 不复述、导出或传播学生姓名、联系方式、健康信息及其他可能导致开盒的细节。
- 不把匿名榜单中的指控写成确定事实，不因“上榜”自动降低导师人品分。
- 不把同一内容的镜像、转载或引用视为多个独立来源。
- 不省略同段落中的 rebuttal、争议标记或后续更正。
- 严重负面判断必须有可核验的一手来源或多个相互独立来源。
- 发送套磁邮件或形成最终申请决策前，重新检查招生状态和公开证据的时效性。
