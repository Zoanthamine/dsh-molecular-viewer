# DSH Molecular Viewer

[简体中文](README.zh-CN.md) · [Agent integration](docs/AGENT-INTEGRATION.md)

A local 3D viewer for **existing molecular coordinates**, packaged as a DeepSeek Harness (DSH) plugin with an offline companion. It does not generate structures, optimize geometries, add hydrogens, run quantum chemistry, or upload molecular data.

## Install

Requirements: Node 22+, DSH 0.2.2-rc.2+, and the enabled `dsh-better-sidebar` 0.32.1 API (`>=0.32.1 <0.33.0`). The plugin requires this sidebar service; the offline version does not.

Use the prebuilt release; there are no install-time build scripts:

```sh
dsh plugin add https://github.com/Zoanthamine/dsh-molecular-viewer/releases/download/v0.2.2/dsh-molecular-viewer-0.2.2.tgz
```

Refresh the existing DSH page, open the current conversation, and select **+ → 分子三维** in the sidebar. Sign in normally if required. Alternatively, download the offline ZIP from [Releases](https://github.com/Zoanthamine/dsh-molecular-viewer/releases), extract it, and open `index.html`. Keep its companion files and `vendor/` directory together. No server or network is needed for offline viewing.

## Formats and controls

- **XYZ / multi-frame XYZ**: existing Cartesian coordinates; inferred connections are display-only, not chemical bond-order assignments.
- **MOL/SDF V2000**: explicit connections and bond orders. V3000/query structures are rejected; planar coordinates are not embedded into 3D. MDL aromatic type 4 is retained in parsed data and drawn as a single-line schematic, not assigned a Kekulé form.
- **PDB**: ATOM/HETATM, multiple MODEL blocks, and CONECT. Consistent alternate locations are selected per residue; occupancy is not a thermodynamic weight.
- **Gaussian**: Cartesian GJF/COM; Input/Standard orientation blocks in LOG/OUT; Atomic numbers and Current cartesian coordinates arrays in FCHK/FCH, with validated counts and Bohr-to-Å conversion.
- **ORCA**: explicit Cartesian `* xyz` / `%coords` INP blocks, and ANGSTROEM/ANGSTROM/A.U. output coordinate tables. External `xyzfile` references are not silently read.
- Ball-and-stick, sticks and space filling; hide hydrogens; atom labels; rotate, zoom and reset; distance/angle/dihedral measurements; PNG and current-frame XYZ export.
- Frame navigation, last output frame, explicitly marked converged frame, and trajectory playback at 1/3/6 frames per second. Step labels require an explicit Gaussian Step number or ORCA optimization cycle marker.

Source details are collapsed by default. Important parse failures, omitted records and degraded display remain visible.

**Last output is not last converged.** Normal termination and SCF convergence are not geometry convergence. A marked optimized coordinate block is not proof of a minimum or transition state. Playback follows source coordinate-block order; it does not align frames, interpolate motion or represent MD physical time. Repeated tables/unit variants may be separate frames. XYZ export loses bond orders, isotopes and other per-atom properties.

Z-matrices, mixed multi-job inputs, ghost/dummy extensions, binary CHK, actual GIF images/animations and implicit external coordinate files are not guessed or converted.

## Agent integration

```js
molecule_open({path: "existing.log", frame: "all", title: "Optimization trajectory"})
molecule_open({path: "existing.log", frame: "last-converged"})
molecule_open({path: "existing.fchk", frame: "1"})
```

Selectors: `all`, `first`, `last`, `last-converged`, or a positive **1-based string**. All original frames remain available for navigation. An absent explicit convergence marker is an error, never a fallback to the last frame.

`molecule_open` returns **queued**, not rendered, and no atomic coordinate arrays. The active conversation GUI performs the scoped file read and rendering. The bundled `lib/extract-coordinates.mjs` can inspect or explicitly export a **new** XYZ through authorized host execution:

```sh
node /path/to/plugin/lib/extract-coordinates.mjs --input existing.log --frame all
node /path/to/plugin/lib/extract-coordinates.mjs --input existing.log --frame last-converged --output NEW.xyz
```

No output option means read-only inspection. Existing output files are never overwritten. See [the integration guide](docs/AGENT-INTEGRATION.md) for limits and evidence handling.

## Boundaries

32 MiB per file; 10,000 atoms per frame; 500 frames; 100,000 atom coordinates across opened files. Display-only connection inference has bounded comparisons and falls back to coordinates with a warning if exceeded. Data stays in page memory; there is no cloud storage or localStorage. DSH file access reuses the host's scoped `sidebar/api/fs.read`; the new route only serves predefined assets and session-bound open requests. The iframe bridge requires the same-origin parent; opaque `file://` origins use manual file selection instead. None of these rules bypass DSH permissions or authentication.

## Development and distribution

```sh
node --test tests/*.test.cjs tests/*.test.mjs
node scripts/audit-public.mjs
python build-offline.py
pnpm pack --pack-destination dist
node scripts/audit-public.mjs dist/dsh-molecular-viewer-0.2.2.tgz
```

Tests use synthetic inputs and frozen rendering-core digests, not personal calculation files or a private DSH installation. CI runs on Node 22 and 24. Vendored 3Dmol.js 2.5.3 and its BSD license are included; no downloaded build or install hook is required.

Version **0.2.2** fixes Chem3D-style PDB files with repeated atom names and no alternate locations: distinct atom serials and their explicit CONECT connections are preserved. Actual alternate-location selection still applies only to the affected sites. Synthetic regression tests cover this behavior; private inputs, paths, local acceptance records and research history are excluded. Market listing is a separate maintainer-reviewed submission, not guaranteed by publishing a release.

## License

Plugin code: MIT. 3Dmol.js: BSD-3-Clause plus notices in its distributed license. See [LICENSE](LICENSE), [third-party notices](THIRD_PARTY_NOTICES.md), and [the bundled upstream license](public/vendor/3Dmol-LICENSE.txt).
