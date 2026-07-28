# カード絵柄 生成プロンプト集

ミュシャ（アルフォンス・ミュシャ）様式のカード絵柄を、画像生成モデル
（Nano Banana / Gemini image、Midjourney、DALL·E など）で作るためのプロンプト集。

---

## 使い方

### 1. 様式を固定する

14枚が「一つの組物」に見えることが最優先。**まず 10番（世界周遊）を作り、
気に入った1枚を style reference として残りに渡す**のが最も確実。
Nano Banana / Gemini image は参照画像を入力に取れるので、
2枚目以降は「参照画像と同じ画風・同じ配色体系・同じ線の太さで」と添えて生成する。

### 2. 共通前置き（STYLE BLOCK）

以下を **毎回、各カードの主題の前に貼る**。ここを変えると組物が崩れる。

```
Art Nouveau poster panel in the style of Alphonse Mucha, Paris 1898.
A single young woman fills most of the frame, drawn with a confident,
even-weight dark sepia contour line and flat, chalky, desaturated color fill.
No shading gradients, no photorealism, no 3D render, no airbrush.
Her long hair flows into ornamental whiplash curves that fill the empty space.
A large decorative circular halo behind her head, filled with a fine mosaic
of small tiles. An ornamental floral border frames the panel, with stylized
lilies, poppies and ivy. Muted lithograph palette on a flat cream ground.
Vertical poster composition. Hand-drawn lithograph texture.
No text, no letters, no numbers, no signature, no watermark.
```

> **「No text」は必ず残すこと。** 数字とカード名はアプリ側で重ねて描画するため、
> 絵の中に文字が入ると二重になる。

### 3. 出力仕様

| 項目 | 指定 |
|---|---|
| 縦横比 | **2:3（縦長）** |
| 解像度 | 長辺 1536px 以上（PNG 推奨、JPEG も可） |
| 文字 | 入れない |
| 余白 | 装飾枠が画面端まで届いてよい（アプリ側で角丸・影を付ける） |

### 4. ファイル名

生成したら、この名前で渡してください。そのまま組み込みます。

```
01.png  02.png  03.png  04.png  05.png
06.png  07.png  08.png  09.png  10.png
prestige.png   scandal.png   passe.png   fauxpas.png
title.png      （表紙用・任意・3:4 または 1:1）
```

---

## 価値の階層（配色で読ませる）

絵柄だけでなく**配色そのものを価値の梯子**にする。各プロンプトの末尾に
対応する PALETTE 行を必ず添えること。

| 段 | カード | PALETTE 行 |
|---|---|---|
| 1 | 1・2・3 | `Palette: ivory, pale sage green, soft grey-green, a little muted rose. Quiet and sparse ornament. Cream background.` |
| 2 | 4・5・6 | `Palette: warm amber, ochre, soft terracotta, cream. Moderate gold ornament. Warm sand background.` |
| 3 | 7・8 | `Palette: dusty rose, plum, wine red, antique gold. Rich, denser ornament. Blush background.` |
| 4 | 9・10 | `Palette: deep emerald green ground with heavy antique gold ornament and ivory skin tones. The most opulent card of the set. Radiant gilded halo.` |

不名誉札は個別に指定（各プロンプト参照）。

---

# 高級品カード（1〜10）

数字が大きいほど「格が上がる」構図にしてある。1 は私的で慎ましく、
10 は世界を手中にする構図。

---

### 01 — 香水 / Perfume　(価値 1)

```
[STYLE BLOCK]

Subject: a young woman with closed eyes lifting a small faceted crystal
perfume flacon to her cheek. A thin ribbon of scent curls upward from the
stopper and dissolves into the mosaic halo behind her. Small pale blossoms
are tucked into her hair. Intimate, quiet, tender mood.

Palette: ivory, pale sage green, soft grey-green, a little muted rose.
Quiet and sparse ornament. Cream background.
```

### 02 — シャンパン / Champagne　(価値 2)

```
[STYLE BLOCK]

Subject: a young woman raising a shallow coupe glass in a private toast,
head tilted back slightly, a faint smile. Rising bubbles become small gold
circles scattered across the mosaic halo. Grapevine tendrils are woven
through her hair. Light, effervescent mood.

Palette: ivory, pale sage green, soft grey-green, a little muted rose.
Quiet and sparse ornament. Cream background.
```

### 03 — 美食 / Gastronomy　(価値 3)

```
[STYLE BLOCK]

Subject: a young woman carrying a footed silver platter heaped with figs,
grapes and pomegranates, a sheaf of wheat woven into her hair. She looks
down at the fruit. Abundant, harvest-like, generous mood.

Palette: ivory, pale sage green, soft grey-green, a little muted rose.
Quiet and sparse ornament. Cream background.
```

### 04 — カジノ / Casino　(価値 4)

```
[STYLE BLOCK]

Subject: a young woman resting one hand on the rim of a large roulette wheel
seen at an angle, holding a fan of playing cards in the other hand. She looks
out at the viewer with a knowing, challenging expression. Stacks of gaming
chips at the lower edge.

Palette: warm amber, ochre, soft terracotta, cream. Moderate gold ornament.
Warm sand background.
```

### 05 — 衣装 / Couture　(価値 5)

```
[STYLE BLOCK]

Subject: a young woman in a sweeping embroidered evening gown with a long
train, turning back over her shoulder so the fabric spirals around her.
A folded fan in her hand. The embroidery pattern of the gown echoes the
floral border. Elegant, poised mood.

Palette: warm amber, ochre, soft terracotta, cream. Moderate gold ornament.
Warm sand background.
```

### 06 — 休暇 / Vacation　(価値 6)

```
[STYLE BLOCK]

Subject: a young woman standing under a lace parasol, a light shawl caught
by the wind and streaming sideways. Behind her, stylized sea waves and a low
sun fill the mosaic halo. Serene, unhurried, sunlit mood.

Palette: warm amber, ochre, soft terracotta, cream. Moderate gold ornament.
Warm sand background.
```

### 07 — 芸術 / The Arts　(価値 7)

```
[STYLE BLOCK]

Subject: a young woman seated with a large classical lyre resting against
her shoulder, one hand on the strings, gazing upward as if listening.
A laurel wreath crowns her hair. Exalted, inspired mood.

Palette: dusty rose, plum, wine red, antique gold. Rich, denser ornament.
Blush background.
```

### 08 — 宝飾 / Jewels　(価値 8)

```
[STYLE BLOCK]

Subject: a young woman clasping an ornate necklace at her throat, a large
teardrop gem hanging from it. A jeweled diadem in her hair, rings on her
fingers, heavy drop earrings. She regards the viewer coolly. The halo mosaic
glitters like set stones. Sumptuous mood.

Palette: dusty rose, plum, wine red, antique gold. Rich, denser ornament.
Blush background.
```

### 09 — 馬術 / Equestrian　(価値 9)

```
[STYLE BLOCK]

Subject: a young woman in a tailored riding habit standing beside a horse's
head, her gloved hand resting on its cheek, her face close to the horse.
The horse's mane and her own loose hair flow together into one continuous
ornamental whiplash pattern. Noble, commanding mood.

Palette: deep emerald green ground with heavy antique gold ornament and ivory
skin tones. The most opulent tier of the set. Radiant gilded halo.
```

### 10 — 世界周遊 / Grand Tour　(価値 10)

```
[STYLE BLOCK]

Subject: a young woman in a long travelling cloak, one hand on a large
armillary sphere, the other raised. Behind her the halo becomes a gilded
star map with constellations, and a single swallow in flight. The floral
border includes plants from distant countries. The grandest and most
elaborate card of the entire set — treat this as the crown of the series.

Palette: deep emerald green ground with heavy antique gold ornament and ivory
skin tones. The most opulent tier of the set. Radiant gilded halo.
```

---

# 特殊カード

---

### prestige — プレステージ (×2)

```
[STYLE BLOCK]

Subject: a triumphant young woman crowned with a full laurel wreath, both
arms raised, holding a radiant golden star above her head. Golden rays burst
from the star and fill the entire halo. Her robe falls in classical folds.
Victorious, luminous, apotheosis mood.

Palette: deep emerald green ground, opulent antique gold, ivory. Radiant
gilded halo with rays. The brightest card of the set.
```

### scandal — スキャンダル (÷2)

```
[STYLE BLOCK]

Subject: a young woman turning away from the viewer, half her face hidden
behind a black lace veil, holding a cracked hand mirror whose broken shards
reflect fragments of her. Thorny bramble winds through the floral border and
strangles the flowers. Cold, whispered, disgraced mood.

Palette: desaturated grey-green, cold slate, tarnished silver, deep bottle
green. Muted and joyless — the ornament is dulled, not gilded.
```

### passe — パセ (−5)

```
[STYLE BLOCK]

Subject: an older woman, once beautiful, looking down at a wilted rose in her
hand as its petals fall away. The flowers of the border are drooping and dry.
Her hair has lost its volume. Melancholy, faded, past-her-season mood.

Palette: faded rose, dusty crimson, ash grey, on a deep red wine ground.
The gold ornament is worn and thin.
```

### fauxpas — フォーパ

```
[STYLE BLOCK]

Subject: a young woman recoiling in dismay, an overturned goblet in her hand
spilling dark wine in a long stain across the front of her pale gown.
A broken fan lies at her feet. The border flowers are knocked askew.
Embarrassed, caught-out, ruinous mood.

Palette: deep red wine ground, cream and ivory gown, dark spilled crimson.
Sharp and jarring against the rest of the set.
```

---

### title — 表紙（任意）

3:4 または 1:1。カードではないので装飾枠は不要。

```
Art Nouveau poster in the style of Alphonse Mucha, Paris 1898.
A young woman seen in profile, with an elaborate crown of flowers and an
immense mass of flowing hair that fills the frame as ornamental whiplash
curves. A large gilded circular halo behind her head with a fine mosaic ring.
Confident even-weight dark contour line, flat chalky color, no gradients,
no photorealism. Deep plum and midnight purple ground with antique gold.
Regal, magnetic, the queen of the ballroom.
No text, no letters, no numbers, no signature, no watermark.
```

---

## 生成後にすること

上記の名前で画像を渡してください。こちらで以下を行います。

- 価値との対応付け（01→香水、09→馬術 …）
- リポジトリ `art/` への配置と、カード面のレイアウト調整
  （数字と名前を載せる銘板の位置・可読性を、実際の絵に合わせて詰めます）
- 先読み込み（めくった瞬間に絵が出るように）とファイルサイズ最適化
- 絵が届いていないカードは、現行の SVG 意匠に自動で退避

うまくいかない絵が出た場合は、その番号を教えてもらえれば
主題行を書き換えて再生成用の文面を出します。
