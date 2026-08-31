- **Stale incremental typecheck state.** `tsc` reuses `tsconfig.tsbuildinfo`
  between runs, and stale state produces errors that do not exist in the source
  — most often a duplicate-type complaint about a file nobody touched. Two runs
  of the identical command minutes apart can disagree. `verify.sh` deletes the
  file before typechecking for exactly this reason; if you see such an error
  outside the gate, delete it and rerun before believing it.
