// Text whose characters flip when they change: the digits of the clock turn over like the ones of a split-flap board. Every character is
// its own element, keyed by its place and its value, so a new value starts the flip again. The text that is read is the same as the plain one.
export function FlipText({ text }: { text: string }) {
    return (
        <>
            {Array.from(text).map((character, index) => {
                return (
                    <span key={`${String(index)}-${character}`} className="flip__char">
                        {character}
                    </span>
                );
            })}
        </>
    );
}
