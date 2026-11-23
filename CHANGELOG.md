# Changelog

## 0.2.2 — Chem3D PDB compatibility

- Preserve distinct atom serials when atom names repeat without an explicit alternate-location site, including Chem3D exports with blank residue names.
- Keep existing consistent-residue alternate-location selection for actual alternate atom sites.
- Add synthetic repeated-name, 60-atom, connectivity and mixed-altloc regressions; no user molecular file is included.

## 0.2.1 — public distribution

- Public GitHub repository, bilingual setup documentation, agent integration guide and synthetic regression tests.
- Curated package file list; excludes personal calculation inputs, paths, local validation receipts and research Git history.
- Portable Node tests and release-content privacy audit.
- Runtime, parser, viewer and extraction files are byte-identical to the validated 0.2.0 implementation.

## 0.2.0 — coordinate formats and agent linkage

- Gaussian and ORCA Cartesian input/output parsing; FCHK/FCH array validation and Bohr conversion.
- Explicit frame selectors, optimization step evidence and bounded trajectory playback.
- Session-scoped agent opening; read-only inspection and explicit no-clobber XYZ export.
- Collapsed metadata details; necessary warnings remain visible.
