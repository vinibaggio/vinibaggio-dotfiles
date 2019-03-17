#!/bin/bash

defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
defaults write com.apple.screencapture disable-shadow -bool true
brew bundle --file brewfiles/Brewfile
