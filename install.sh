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
# -f -n replaces an existing or dangling link in place. A link copied from another
# Mac points at that Mac's home and looks "absent" to `test -e`, but `ln -s`
# without -f still refuses to overwrite it.
ln -sfn "$DOTFILES_DIR/config" .config
ln -sfn "$DOTFILES_DIR/bashrc" .bashrc
ln -sfn "$DOTFILES_DIR/zsh/zshrc" .zshrc
ln -sfn "$DOTFILES_DIR/zsh/zsh_plugins.txt" .zsh_plugins.txt

# Agent skills and rules (omp, Claude Code, Codex). Skills link one directory
# at a time so skills installed from other sources can live next to them.
mkdir -p .agents/skills .omp/agent .claude .codex
for skill in "$DOTFILES_DIR"/agents/skills/*/; do
  ln -sfn "${skill%/}" ".agents/skills/$(basename "$skill")"
done
ln -sfn "$DOTFILES_DIR/agents/omp/RULES.md" .omp/agent/RULES.md
ln -sfn "$DOTFILES_DIR/agents/claude/CLAUDE.md" .claude/CLAUDE.md
ln -sfn "$DOTFILES_DIR/agents/codex/AGENTS.md" .codex/AGENTS.md

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
