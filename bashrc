 export PATH=/usr/local/bin:$PATH

eval "$(fasd --init auto)"

source "$HOME/code/vinibaggio-dotfiles/zsh/aliases"

export PATH="$PATH:$HOME/code/vinibaggio-private/bin"
export PATH="$PATH:$HOME/code/vinibaggio-dotfiles/bin"


[ -f ~/.fzf.bash ] && source ~/.fzf.bash

# Added by LM Studio CLI (lms)
export PATH="$PATH:$HOME/.lmstudio/bin"
# End of LM Studio CLI section


# Added by git-ai installer on Thu Jul  9 12:14:41 EDT 2026
export PATH="$HOME/.git-ai/bin:$PATH"
