#!/bin/bash

set +x
set +e

echo "Running OS specific install..."

if [ "$(uname)" == "Linux" ]; then
  ./install-linux.sh
elif [ "$(uname)" == "Darwin" ]; then
  ./install-mac.sh
fi

echo "Linking config files..."
pushd $HOME
test ! -e "$HOME/.config" && ln -s code/vinibaggio-dotfiles/config .config
test ! -e "$HOME/.bashrc" && ln -s code/vinibaggio-dotfiles/bashrc .bashrc
test ! -e "$HOME/.zshrc" && ln -s code/vinibaggio-dotfiles/zsh/zshrc .zshrc
test ! -e "$HOME/.zsh_plugins.txt" && ln -s code/vinibaggio-dotfiles/zsh/zsh_plugins.txt .zsh_plugins.txt

# Install kickstart nvim
test ! -e "$HOME/.config/nvim" && git clone https://github.com/vinibaggio/kickstart.nvim.git $HOME/.config/nvim

popd

echo "Installing nvim plugins..."
nvim --headless "+Lazy! sync" +qa

echo "Running general bundle"
brew bundle

echo "Installing private repo things if exists..."
if [ -d "$HOME/code/vinibaggio-private" ]; then
  pushd "$HOME/code/vinibaggio-private" 
  sh ./install.sh
  popd
fi

echo "Setup complete."
