# Hexa developer shortcuts.
# Upstream engine Cargo target names remain implementation details under engine/.

default:
    @just --list

setup:
    node hexa.mjs setup

check:
    node hexa.mjs check

dev:
    node hexa.mjs dev

build:
    node hexa.mjs build

typecheck:
    node hexa.mjs typecheck

engine-check:
    node hexa.mjs engine-check

engine-build:
    node hexa.mjs engine-build

upstream ref:
    node hexa.mjs upstream-update {{ref}} --apply

version source:
    node hexa.mjs version-import {{source}} --apply

pack:
    node hexa.mjs pack

dist:
    node hexa.mjs dist

clean:
    node hexa.mjs clean
