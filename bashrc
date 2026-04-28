 export PATH=/usr/local/bin:$PATH

eval "$(fasd --init auto)"

source "$HOME/code/vinibaggio-dotfiles/zsh/aliases"

export PATH="$PATH:$HOME/code/vinibaggio-private/bin"
export PATH="$PATH:$HOME/code/vinibaggio-dotfiles/bin"


[ -f ~/.fzf.bash ] && source ~/.fzf.bash

# Added by LM Studio CLI (lms)
export PATH="$PATH:$HOME/.lmstudio/bin"
# End of LM Studio CLI section

