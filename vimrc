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
" set switchbuf=useopen
" set winwidth=100
" set winheight=25

" Expand path in command
cnoremap %% <C-R>=expand('%:h').'/'<cr>

if &t_Co > 255
  colorscheme lanai
  set colorcolumn=85
endif

nnoremap <leader><space> :noh<cr>

" Learn correctly, stupid
nnoremap <up> <nop>
nnoremap <down> <nop>
nnoremap <left> <nop>
nnoremap <right> <nop>
inoremap <up> <nop>
inoremap <down> <nop>
inoremap <left> <nop>
inoremap <right> <nop>
nnoremap j gj
nnoremap k gk

" As seen on Vimcasts, expand path for the current file
let mapleader=','
map <leader>ew :e <C-R>=expand("%:p:h") . "/" <CR>
map <leader>es :sp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>ev :vsp <C-R>=expand("%:p:h") . "/" <CR>
map <leader>et :tabe <C-R>=expand("%:p:h") . "/" <CR>

map <leader>s :set spell<CR>
map <leader>S :set nospell<CR>
map <leader>r :so ~/.vimrc<CR>

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

function! Bright()
  set background=light
  colorscheme solarized
  set transparency=0
  set gfn=Inconsolata-dz:h18
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

nnoremap <silent> <leader>T :TagbarToggle<CR>

" TAB idents, STab unindents (thanks hashrocket!)
vnoremap <silent> <TAB> >gv
vnoremap <silent> <S-TAB> <gv

" Faster commands
nnoremap ; :

" Use Q for formatting the current paragraph (or selection)
vmap Q gq
nmap Q gqap

nnoremap <silent> <F5> :call <SID>StripTrailingWhitespaces()<CR>

set laststatus=2

" let g:Powerline_symbols='fancy'

" formatting text
" set formatprg=par
" set textwidth=80
" set formatoptions+=t

set wildignore+=*.png,*.sp*,*.sqlite3,*.jpg,*.jpeg
