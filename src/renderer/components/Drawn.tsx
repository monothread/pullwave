// Words that repeat what is already written elsewhere on the page (a tile of a shelf over the grid of the same library, the banner of a
// download over its card): the theme draws them from their data-text, so the page holds each of them once for the screen readers and for
// a search of the text. What they say is named by the control that holds them.
export function Drawn({ className, text }: { className: string; text: string }) {
    return <span className={`drawn ${className}`} data-text={text} />;
}
