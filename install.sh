#!/bin/bash

set +x
set +e

echo "Running OS specific install..."

if [ "$(uname)" == "Linux" ]; then
  ./install-linux.sh
elif [ "$(uname)" == "Darwin" ]; then
  ./install-mac.sh
fi

DOTFILES_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Linking config files..."
pushd "$HOME"
test ! -e "$HOME/.config" && ln -s "$DOTFILES_DIR/config" .config
test ! -e "$HOME/.bashrc" && ln -s "$DOTFILES_DIR/bashrc" .bashrc
test ! -e "$HOME/.zshrc" && ln -s "$DOTFILES_DIR/zsh/zshrc" .zshrc
test ! -e "$HOME/.zsh_plugins.txt" && ln -s "$DOTFILES_DIR/zsh/zsh_plugins.txt" .zsh_plugins.txt

# Install kickstart nvim
test ! -e "$HOME/.config/nvim" && git clone https://github.com/vinibaggio/kickstart.nvim.git $HOME/.config/nvim

popd

echo "Installing nvim plugins..."
nvim --headless "+Lazy! sync" +qa

echo "Running general bundle"
brew bundle --file "$DOTFILES_DIR/brewfiles/Brewfile"

echo "Installing private repo things if exists..."
if [ -d "$HOME/code/vinibaggio-private" ]; then
  pushd "$HOME/code/vinibaggio-private" 
  sh ./install.sh
  popd
fi

echo "Setup complete."
