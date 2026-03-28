#!/bin/bash

lua Generate.lua
git add .
git commit -s -m "update"
git push
