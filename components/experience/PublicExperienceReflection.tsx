export type PublicExperienceReflectionData={summary:string;observations:string[];reviewNotice:string};

export function PublicExperienceReflection({reflection}:{reflection:PublicExperienceReflectionData}){
  return <div className="w-full max-w-2xl space-y-8 text-center">
    <h2 className="font-serif text-3xl text-zeya-ivory">Zeya returned with a reflection.</h2>
    <p className="text-zeya-taupe leading-8">{reflection.summary}</p>
    {reflection.observations.length>0&&<div className="space-y-3 text-left border border-zeya-champagne/20 p-6 rounded">
      <p className="text-zeya-champagne text-sm tracking-widest uppercase">Zeya noticed</p>
      {reflection.observations.map((observation,index)=><p key={index} className="text-zeya-ivory/85">{observation}</p>)}
    </div>}
    <p className="text-sm text-zeya-taupe/80">{reflection.reviewNotice}</p>
  </div>;
}
