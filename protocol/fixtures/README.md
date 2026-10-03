# Protocol fixtures

Golden JSON examples shared by the TypeScript server tests and the Kotlin client tests.
Each fixture is a full `SNAPSHOT` or `EVENT` message produced by the reference engine.

Both implementations must parse fixtures byte-for-byte into identical models; a mismatch
fails CI. Real fixtures land with Phase 5/6; this directory is reserved.
