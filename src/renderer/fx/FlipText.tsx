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
