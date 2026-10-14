# 手工验收用例

这些 LaTeX 源码用于验收图片渲染。需由 assistant 在正文中输出；直接 read 文件属于工具结果，不会触发 assistant Markdown transformer。

## 1. 分式、根号与求和

$$
\operatorname{RMSNorm}(x)_i = \frac{x_i}{\sqrt{\frac{1}{d}\sum_{j=1}^{d}x_j^2 + \varepsilon}}\,\gamma_i
$$

验收标记 A：这一行应在图片下方，不得被覆盖。

## 2. Attention 与维度

$$
Q\in\mathbb{R}^{n\times d_k},\quad K\in\mathbb{R}^{m\times d_k},\quad V\in\mathbb{R}^{m\times d_v}
$$

$$
\operatorname{Attention}(Q,K,V)=\operatorname{softmax}\!\left(\frac{QK^{\mathsf T}}{\sqrt{d_k}}\right)V
$$

验收标记 B：缩窄窗口时，图片应缩放而不是覆盖后续文字。

## 3. 矩阵乘法

$$
\begin{bmatrix}1&2\\3&4\end{bmatrix}\begin{bmatrix}x\\y\end{bmatrix}=\begin{bmatrix}x+2y\\3x+4y\end{bmatrix}
$$

验收标记 C：矩阵应有两行，括号完整。

## 4. 多行对齐

\begin{align*}
p_i &= \frac{e^{z_i}}{\sum_j e^{z_j}} \\
\mathcal L &= -\sum_i y_i\log p_i \\
\frac{\partial\mathcal L}{\partial z_i} &= p_i-y_i
\end{align*}

验收标记 D：三个等号对齐，图片下方的文字不能重叠。

## 5. 代码必须保留原文

```tex
$$\frac{a}{b}$$
```

内联代码 `$x^2$` 也不得变成图片。

## 6. 故意失败：必须保留原文，不影响会话

$$\notARealCommand{x}$$

这是故意使用不存在的 TeX 命令。预期最多提示一次渲染失败，本条保留文本，其余公式仍正常。

## 验收操作

- 等整条回复生成结束后检查（流式期间不生成图片）。
- 上下滚动，观察图片是否消失、串位或覆盖文字。
- 缩窄、拉宽窗口，再滚动回来。
- 同一会话 `/reload` 后检查最新 assistant 回复。
- 切换主题：已有不同颜色的缓存允许回退到普通公式；reload 后检查最新回复重建。
- 截图反馈时注明 case 编号，以及 Ghostty / Herdr、窗口宽度和操作。

## 居中验收

在 `richRenderer` 中设置 `"imageAlign": "center"`，保留已验收的 `"imageScale": 1.5`，然后 `/reload` 并请求重新展示本文件的用例。

- 每张公式图片在当前 pane 内居中，左右边距最多相差一个字符列。
- 多行公式整块居中，内部等号对齐关系保持不变。
- 正文、标题和代码块位置不变，公式大小和前后留白不变。
- 拉宽、缩窄 pane 后中心位置重新计算。
- 上下滚动，让多行公式部分移出视口再回来；裁剪和重新显示时仍应居中。
- 改回 `"imageAlign": "left"` 并 reload，可恢复原有布局。
