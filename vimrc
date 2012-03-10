set autoindent
syntax on

" Force bash mode, even in zsh, so Rails.vim work
set sh=bash

" Display line numbers and information ruler
set number
set ruler

" Navigate through buffers without vim whinings on unsaved buffers
set hidden

set hlsearch
set smarttab

" Stop annoying bells
set vb

" Swap files: off you go
set noswapfile

" No folding! I hate folding!
set nofoldenable

set ignorecase
set smartcase
set gdefault

set textwidth=79
set formatoptions=qrn1

" Expand buffer when switching
set switchbuf=useopen
set winwidth=100
set winheight=25

" Expand path in command
cnoremap %% <C-R>=expand('%:h').'/'<cr>

if &t_Co > 255
  colorscheme lanai
  set colorcolumn=85
endif

nnoremap <leader><space> :noh<cr>

" Learn correctly, stupid
" nnoremap <up> <nop>
" nnoremap <down> <nop>
" nnoremap <left> <nop>
" nnoremap <right> <nop>
" inoremap <up> <nop>
" inoremap <down> <nop>
" inoremap <left> <nop>
" inoremap <right> <nop>
" nnoremap j gj
" nnoremap k gk

" As seen on Vimcasts, expand path for the current file
let mapleader=','
map <leader>ew :e <C-R>=expand("%:p:h") . "/" <CR>
map <leader>es :sp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>ev :vsp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>et :tabe <C-R>=expand("%:p:h") . "/" <CR>

map <leader>s :set spell<CR>
map <leader>S :set nospell<CR>
map <leader>r :so ~/.vimrc<CR>
nnoremap <leader><leader> <c-^>

" As seen on Vimcasts
if has("autocmd")
  " File type detection
  filetype on
  filetype plugin indent on

  " Default settings
  set ts=2 sts=2 sw=2 expandtab
  " Styles depending on file type
  autocmd FileType ruby setlocal ts=2 sts=2 sw=2 expandtab
  autocmd FileType python setlocal ts=4 sts=4 sw=4 expandtab
  autocmd FileType javascript setlocal ts=4 sts=4 sw=4 expandtab

  " Treat different file types as one we know. Example:
  " autocmd BufNewFile,BufRead *.rss,*.atom setfiletype xml

  " Automatically remove whitespaces while saving files
  " autocmd BufWritePre *.snippet,*.yml,*.rb,*.html,*.css,*.erb,*.haml :call <SID>StripTrailingWhitespaces()
endif

" Load pathogen
call pathogen#runtime_append_all_bundles()


" As seen on Vimcasts
nnoremap <silent> <F5> :call <SID>StripTrailingWhitespaces()<CR>
function! <SID>StripTrailingWhitespaces()
  " Preparation: save last search and cursor position.
  let _s=@/
  let l = line(".")
  let c = col(".")
  " Do the business
  %s/\s\+$//e
  " Clean up: restore previous search history and cursor position
  let @/=_s
  call cursor(l,c)
endfunction


" As seen on Vimcasts
" Use window movement with Ctrl-h instead of Ctrl-w h and so on
map <C-h> <C-w>h
map <C-j> <C-w>j
map <C-k> <C-w>k
map <C-l> <C-w>l

" As seen on Vimcasts, with a few changes by me

map <D-Right> gt
map <D-Left> gT
map <D-1> 1gt
map <D-2> 2gt
map <D-3> 3gt
map <D-4> 4gt
map <D-5> 5gt
map <D-6> 6gt
map <D-7> 7gt
map <D-8> 8gt
map <D-9> 9gt
map <D-0> :tablast<CR>

" I always type W instead of w
cab W w
cab Q q
cab Vsp vsp
" Map Shift-Tab to autocomplete
" imap <S-Tab> <C-n>

" Map hashrocket as Textmate
imap <C-L> <Space>=><Space>

" I hate Y behavior, isn't natural for me
" so Y now copies until the end of the line
nnoremap Y y$

" TAB idents, STab unindents (thanks hashrocket!)
vnoremap <silent> <TAB> >gv
vnoremap <silent> <S-TAB> <gv

" Faster commands
nnoremap ; :

" Use Q for formatting the current paragraph (or selection)
vmap Q gq
nmap Q gqap

" Command r and Command R
autocmd User Rails nnoremap <buffer> <D-r> :<C-U>Rake<CR>
autocmd User Rails nnoremap <buffer> <D-R> :<C-U>.Rake<CR>

" Command T stuff
map <leader>f :CommandTFlush<cr>\|:CommandT<cr>
map \] :CommandTFlush<cr>\|:CommandT<cr>

nnoremap <silent> <F5> :call <SID>StripTrailingWhitespaces()<CR>

" I don't want the original snippmate snippets
let g:snippets_dir='~/.vim/snippets'
source ~/.vim/snippets/support_functions.vim

"return '[\s]' if trailing white space is detected
"return '' otherwise
function! StatuslineTrailingSpaceWarning()
    if !exists("b:statusline_trailing_space_warning")

        if !&modifiable
            let b:statusline_trailing_space_warning = ''
            return b:statusline_trailing_space_warning
        endif

        if search('\s\+$', 'nw') != 0
            let b:statusline_trailing_space_warning = '[\s]'
        else
            let b:statusline_trailing_space_warning = ''
        endif
    endif
    return b:statusline_trailing_space_warning
endfunction


"Adding a statusline
set statusline=
set statusline+=%<\                           " cut at start
set statusline+=%2*[%n%H%M%R%W]%*\            " buffer number, and flags
set statusline+=%-40f\                        " relative path
set statusline+=%{StatuslineTrailingSpaceWarning()} " Trailing spaces
set statusline+=%*                            "   "
set statusline+=%=                            " seperate between right- and left-aligned
set statusline+=%1*%y%*%*\                    " file type
set statusline+=%10((%l/%v)%)\                " line and column
set statusline+=%P                            " percentage of file
" Show it!
set laststatus=2

"recalculate the trailing whitespace warning when idle, and after saving
autocmd cursorhold,bufwritepost * unlet! b:statusline_trailing_space_warning

" formatting text
" set formatprg=par
" set textwidth=80
" set formatoptions+=t


" Vi's wildignore
set wildignore+=*.png,*.sp*,*.sqlite3,*.jpg,*.jpeg,vendor/ruby/**

" Make supertab use omnicomplete
let g:SuperTabDefaultCompletionType = "context"

" Tagbar
let g:tagbar_usearrows = 1
nmap <leader>l :TagbarToggle<CR>

" Settings for vim clojure
let g:clj_highlight_builtins=1      " Highlight Clojure's builtins
let g:clj_paren_rainbow=1           " Rainbow parentheses'!
let vimclojure#WantNailgun = 1
let vimclojure#NailgunClient = "/Users/vinibaggio/.vim/bundle/vim-clojure/ng"

" RTF pygmentize
let g:rtfp_theme = 'friendly'
let g:rtfp_font = 'Inconsolata'
