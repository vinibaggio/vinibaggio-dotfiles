let g:UltiSnips = {}
let g:UltiSnips.ExpandTrigger = "<tab>"
let g:UltiSnips.JumpBackwardTrigger = "<c-k>"

let g:UltiSnips.UltiSnips_ft_filter = {
                \ 'default' : {'filetypes': ['all'] },
                \ 'all' : {'filetypes': ['all'] },
                \ }

let g:UltiSnips.always_use_first_snippet = 1
let g:UltiSnips.snipmate_ft_filter = {
                \ 'default' : {'filetypes': ["FILETYPE", "_"] },
                \ 'html'    : {'filetypes': ["html", "javascript", "_"] },
                \ }
