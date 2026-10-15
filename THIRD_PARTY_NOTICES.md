# Third-party notices

The Legonizer website is licensed under the GNU General Public License version 3 or later
(see [`LICENSE`](LICENSE)). A few files of this repository contain code copied or ported from other
projects; those portions keep their copyright and licence, listed below. Keep this file with any copy
or modified version of the repository.

Libraries installed from npm (`node_modules/`) are not part of this repository; their licences are
listed in the README (Dependencies) and on the About page.

## three.js

- **In:** `src/core/util/threeCompat.ts`, which ports the three.js r147 and r154 numerics used by the
  legacy pipeline (`Matrix4` and `Quaternion` operations, `Box3.applyMatrix4`, `Ray.intersectTriangle`,
  `Ray.intersectsSphere`, `Ray.intersectsBox`) operation by operation.
- **From:** https://github.com/mrdoob/three.js, releases r147 and r154.
- **Licence:** MIT.

```
The MIT License

Copyright © 2010-2023 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## iTowns

- **In:** `test/parity/legacyReference.ts` (test code, not part of the built site): `C3DTFeature`,
  `C3DTFeature.computeWorldBox3` and the logic of `C3DTilesLayer.initC3DTileFeatures`, ported from
  iTowns 2.41.1-next.9.
- **From:** https://github.com/iTowns/itowns
- **Licence:** iTowns is dual-licensed CeCILL-B 1.0 and MIT; this repository uses it under the MIT
  licence.

```
Copyright 2016 iTowns Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## UD-Viz

- **In:** `test/parity/legacyReference.ts` (test code, not part of the built site): `createMockUpObject`,
  ported from `@ud-viz/widget_legonizer` 4.6.1 `MockUpUtils.js`.
- **From:** https://github.com/VCityTeam/UD-Viz
- **Copyright:** Copyright of University of Lyon, 2012 - 2023.
- **Licence:** GNU Lesser General Public License version 2.1
  (https://www.gnu.org/licenses/old-licenses/lgpl-2.1.txt). As its section 3 allows, this copy is
  used under the GNU General Public License version 3 or later, the licence of this repository (full
  text in [`LICENSE`](LICENSE)).

The site's legacy mode (`src/core/heightmap/legacy.ts`, `area.ts`, `src/core/export/calque.ts`)
reproduces the behaviour and numerics of the UD-Viz widget; it is written from scratch and checked
against the original by the parity tests.

## legonizer (npm package)

No code of `legonizer@1.1.0` is copied into this repository. The site reimplements the behaviour of
its `createHeightMapFromBufferGeometry` (the approach of the CC0 paper hal-04924304), and the parity
tests run the original package, installed as a development dependency and never bundled with the site.

Its licence is the GNU GPL version 3: the `LICENSE` file of its repository
(https://github.com/VCityTeam/Legonizer, since the first commit, 2022-12-20) and of the published npm
package. The `package.json` of version 1.1.0 says ISC, the `npm init` default; its author is changing
it to GPL-3.0 (2026-10-15).
