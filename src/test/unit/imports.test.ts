import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { extractImports } from '../../scanner/imports';

test('java: extracts dotted imports and static imports', () => {
  const src = `
package com.example;

import java.util.List;
import java.util.Map;
import static com.example.util.Strings.isBlank;
import com.example.other.*;

public class Foo {}
`;
  const { raw } = extractImports('java', src);
  assert.deepEqual(raw.sort(), [
    'com.example.other.*',
    'com.example.util.Strings',
    'java.util.List',
    'java.util.Map',
  ]);
});

test('typescript: extracts from / require / dynamic import', () => {
  const src = `
import { a } from './a';
import b from "b";
import 'side-effect';
const c = require('c');
async function f() { return await import('./d'); }
`;
  const { raw } = extractImports('typescript', src);
  assert.deepEqual(raw.sort(), ['./a', './d', 'b', 'c', 'side-effect']);
});

test('python: extracts both import and from-import forms', () => {
  const src = `
import os
import sys, json
from app.services import x
from collections.abc import Mapping
import numpy as np
`;
  const { raw } = extractImports('python', src);
  assert.deepEqual(raw.sort(), ['app.services', 'collections.abc', 'json', 'numpy', 'os', 'sys']);
});

test('go: extracts single and block imports', () => {
  const src = `
package main

import "fmt"
import (
  "os"
  alias "path/filepath"
)
`;
  const { raw } = extractImports('go', src);
  assert.deepEqual(raw.sort(), ['fmt', 'os', 'path/filepath']);
});

test('unsupported language returns empty', () => {
  assert.deepEqual(extractImports('markdown', 'whatever').raw, []);
});
